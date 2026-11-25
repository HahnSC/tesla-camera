import React, { useRef, useState } from 'react'
import {
  Tooltip,
  Button,
  Dialog,
  DialogTrigger,
  DialogSurface,
  DialogTitle,
  DialogBody,
  DialogContent,
  DialogActions,
  Field,
  Radio,
  RadioGroup,
  Checkbox,
  useId,
  Toaster,
  useToastController,
  Toast,
  ToastTitle,
  ToastBody,
  makeStyles,
  tokens,
} from '@fluentui/react-components'
import { ResizeVideo24Filled } from '@fluentui/react-icons'
import { type OriginVideo, type ExportTaskType, ExportStatusEnum } from '../model'
import { loadDashcamSeiFile, type DashcamSample } from '../dashcam-sei'
import { buildFfmpegArgs, overlayAssetNames, parseVideoSize } from '../export-overlay'
import { open } from '@tauri-apps/plugin-dialog'
import { Command } from '@tauri-apps/plugin-shell'
import { mkdir, remove, writeTextFile } from '@tauri-apps/plugin-fs'
import { getName } from '@tauri-apps/api/app'
import { appLocalDataDir, resolveResource } from '@tauri-apps/api/path'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import ExportTask from './export-task'
import { durationToMs } from '../tool'

interface FfmpegExportProps {
  videos: OriginVideo[]
}

interface ExportFile {
  name: string
  path: string
  time: number
}

type CameraType = 'f' | 'b' | 'l' | 'r' | 'lp' | 'rp'

const useStyles = makeStyles({
  root: {},
  currentExportDir: {
    color: tokens.colorNeutralForeground3,
  },
})

const getFile = (camera: CameraType, video: OriginVideo): ExportFile => {
  const source = {
    f: video.src_f,
    b: video.src_b,
    l: video.src_l,
    r: video.src_r,
    lp: video.src_lp,
    rp: video.src_rp,
  }[camera]
  return {
    name: source?.name ?? '',
    path: source?.path ?? '',
    time: video.time,
  }
}

const outputName = (files: ExportFile[]) => {
  if (files.length === 1) return files[0].name
  const base = files[0].name.replace(/\.mp4$/i, '')
  return `${base}-x${files.length}.mp4`
}

interface OverlayOptions {
  timestamp: boolean
  dashboard: boolean
}

const ffmpegPath = (filePath: string) => filePath.replace(/\\/g, '/')

const exportArgs = async (
  files: ExportFile[],
  exportDir: string,
  fileName: string,
  options: OverlayOptions,
) => {
  const samples = options.dashboard
    ? await Promise.all(files.map(file => loadDashcamSeiFile(file.path).catch(() => [] as DashcamSample[])))
    : files.map(() => [] as DashcamSample[])
  const sizes = await Promise.all(files.map(async file => {
    let log = ''
    const probe = Command.sidecar('binaries/ffmpeg', ['-hide_banner', '-i', ffmpegPath(file.path)])
    probe.stderr.on('data', line => { log += lineText(line) })
    await new Promise<void>(resolve => {
      probe.on('close', () => resolve())
      probe.on('error', () => resolve())
      probe.spawn().catch(() => resolve())
    })
    return parseVideoSize(log)
  }))
  const assets: Record<string, string> = {}
  if (options.dashboard && samples.some(list => list.length > 0)) {
    for (const name of overlayAssetNames) {
      if (!samples.some(list => list.length)) break
      assets[name] = ffmpegPath(await resolveResource(`overlay/${name}.png`))
    }
  }
  return buildFfmpegArgs({
    files,
    output: `${exportDir}/${fileName}`,
    options,
    samples,
    sizes,
    assets,
  })
}

const lineText = (line: unknown) => typeof line === 'string' ? line : ''

// Windows CreateProcess stops at 32767 characters. One dashboard graph is already past that.
const placeFilterScript = async (args: string[]) => {
  const index = args.indexOf('-filter_complex')
  if (index < 0) return { args, script: '' }
  const dir = (await appLocalDataDir()).replace(/[\\/]+$/, '')
  await mkdir(dir, { recursive: true })
  const script = `${dir}/tesla-export-${Date.now()}.txt`
  await writeTextFile(script, args[index + 1])
  const next = args.slice()
  next.splice(index, 2, '-filter_complex_script', ffmpegPath(script))
  return { args: next, script }
}

const doTask = async (
  files: ExportFile[],
  exportDir: string,
  options: OverlayOptions,
  log: (arg: {
    path: string
    name: string
    exportDir: string
    status: number
    log: string
  }) => void,
) => {
  const fileName = outputName(files)
  const filePath = `${exportDir}/${fileName}`
  let failure = ''
  const report = (status: number, text: string) => {
    log({
      name: fileName,
      path: filePath,
      exportDir,
      status,
      log: text,
    })
  }
  let script = ''
  const dropScript = () => {
    if (!script) return
    const path = script
    script = ''
    remove(path).catch(() => {})
  }
  try {
    const placed = await placeFilterScript(await exportArgs(files, exportDir, fileName, options))
    script = placed.script
    const command = Command.sidecar('binaries/ffmpeg', placed.args)
    command.on('close', payload => {
      dropScript()
      const ok = payload.code === 0
      report(ok ? ExportStatusEnum.导出成功 : ExportStatusEnum.导出失败, ok ? 'success' : (failure || `exit ${payload.code}`))
    })
    command.on('error', error => {
      failure = error
      report(ExportStatusEnum.导出失败, error)
    })
    command.stdout.on('data', line => {
      report(ExportStatusEnum.进行中, lineText(line))
    })
    command.stderr.on('data', line => {
      const text = lineText(line)
      if (/error|invalid|failed|cannot|no such/i.test(text)) failure = text.trim()
      report(ExportStatusEnum.进行中, text)
    })
    const child = await command.spawn()
    report(ExportStatusEnum.进行中, `pid: ${child.pid}`)
    return true
  } catch (error) {
    dropScript()
    const text = error instanceof Error ? error.message : String(error)
    report(ExportStatusEnum.导出失败, text)
    return false
  }
}

const FfmpegExport: React.FC<FfmpegExportProps> = (props) => {
  const [dialogIsOpen, setDialogIsOpen] = useState(false)
  const [tasks, setTasks] = useState<ExportTaskType[]>([])
  const tempTasks = useRef(tasks)
  const [exportDir, setExportDir] = useState(localStorage.getItem('exportDir') ?? '')
  const [camera, setCamera] = useState<CameraType>(localStorage.getItem('camera') as CameraType ?? 'f')
  const [withTimestamp, setWithTimestamp] = useState(true)
  const [withDashboard, setWithDashboard] = useState(false)
  const toasterId = useId('toaster')
  const timestampId = useId('export-timestamp')
  const dashboardId = useId('export-dashboard')
  const { dispatchToast } = useToastController(toasterId)
  const styles = useStyles()
  const selectExportDir = async () => {
    const exportDir = await open({
      directory: true,
      multiple: false,
      recursive: true,
    })
    if (!exportDir) {
      return
    }
    localStorage.setItem('exportDir', exportDir as string)
    setExportDir(exportDir as string)
  }
  const onConfirm = async () => {
    if (!exportDir) {
      dispatchToast(
        <Toast>
          <ToastTitle>
            提示
          </ToastTitle>
          <ToastBody>
            请选择导出文件目录
          </ToastBody>
        </Toast>,
        { intent: 'warning' },
      )
      return
    }
    const files = [...props.videos]
      .sort((a, b) => a.time - b.time)
      .map(video => getFile(camera, video))
      .filter(file => file.path)
    if (!files.length || files.length !== props.videos.length) {
      dispatchToast(
        <Toast>
          <ToastTitle>提示</ToastTitle>
          <ToastBody>有片段没有该视角</ToastBody>
        </Toast>,
        { intent: 'warning' },
      )
      return
    }
    const fileName = outputName(files)
    const filePath = `${exportDir}/${fileName}`
    const existsTask = tasks.find(item => item.path === filePath)
    if (existsTask) {
      dispatchToast(
        <Toast>
          <ToastTitle>
            提示
          </ToastTitle>
          <ToastBody>
            导出任务已存在
          </ToastBody>
        </Toast>,
        { intent: 'warning' },
      )
      return
    }
    setDialogIsOpen(false)
    try {
      const afterNoticePermission = await isPermissionGranted()
      if (!afterNoticePermission) {
        requestPermission()
      }
    } catch {
      // Notification permission must not block the export.
    }
    const started = await doTask(
      files,
      exportDir,
      { timestamp: withTimestamp, dashboard: withDashboard },
      async ({
        path, status, log, exportDir, name,
      }) => {
        const temp = [...tempTasks.current]
        const existsIndex = temp.findIndex(item => item.path === path)
        const lineLog = log.trim()
        let duration
        let progress
        if (lineLog.startsWith('Duration')) {
          const durationStr = lineLog.match(/[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?,/)?.[0]?.slice(0, -1)
          if (durationStr) {
            const prev = existsIndex > -1 ? temp[existsIndex].duration : 0
            duration = (prev > 1 ? prev : 0) + durationToMs(durationStr)
          }
        }
        if (lineLog.startsWith('out_time_ms')) {
          const progressStr = lineLog.slice(lineLog.indexOf('=') + 1)
          if (progressStr) {
            progress = Math.max(0, +progressStr / 1000)
          }
        }
        const previous = existsIndex > -1 ? temp[existsIndex] : undefined
        const keepStatus = !!previous && previous.status !== ExportStatusEnum.进行中 && status === ExportStatusEnum.进行中
        const nextStatus = keepStatus && previous ? previous.status : status
        if (previous) {
          temp.splice(existsIndex, 1, {
            ...previous,
            status: nextStatus,
            duration: duration ?? previous.duration,
            progress: progress ?? previous.progress,
            log: [...previous.log, log],
          })
        } else {
          temp.push({
            name,
            path: filePath,
            exportDir,
            status: nextStatus,
            duration: duration ?? 1,
            progress: 0,
            log: [log],
          })
        }
        tempTasks.current = temp
        setTasks(temp)
        if (keepStatus) return
        if (nextStatus === ExportStatusEnum.导出成功) {
          dispatchToast(
            <Toast>
              <ToastTitle>
                提示
              </ToastTitle>
              <ToastBody>
                {exportDir}/{name} 导出成功
              </ToastBody>
            </Toast>,
            { intent: 'success' },
          )
          if (await isPermissionGranted()) {
            const appName = await getName()
            const iconPath = await resolveResource('icons/128x128.png')
            sendNotification({
              title: `${appName}导出通知`,
              body: `文件导出成功: ${exportDir}`,
              icon: iconPath,
            })
          }
        }
        if (nextStatus === ExportStatusEnum.导出失败) {
          dispatchToast(
            <Toast>
              <ToastTitle>
                提示
              </ToastTitle>
              <ToastBody>
                {exportDir} 导出失败 {lineLog.slice(0, 180)}
              </ToastBody>
            </Toast>,
            { intent: 'error' },
          )
          if (await isPermissionGranted()) {
            const appName = await getName()
            const iconPath = await resolveResource('icons/128x128.png')
            sendNotification({
              title: `${appName}导出通知`,
              body: `文件导出失败: ${exportDir}`,
              icon: iconPath,
            })
          }
        }
      },
    )
    if (!started) return
    dispatchToast(
      <Toast>
        <ToastTitle>
          提示
        </ToastTitle>
        <ToastBody>
          导出任务已开始，请耐心等待
        </ToastBody>
      </Toast>,
      { intent: 'info' },
    )
  }
  return (
    <>
      {
        props.videos.length ? (
          <>
            <Dialog
              modalType="modal"
              open={dialogIsOpen}
              onOpenChange={(_, data) => {
                if (data.type === 'backdropClick') {
                  setDialogIsOpen(data.open)
                }
              }}
            >
              <DialogTrigger>
                <Tooltip content={props.videos.length > 1 ? <>按时间顺序拼接导出 {props.videos.length} 段</> : <>导出带有时间码的视频</>} relationship="label">
                  <Button
                    icon={<ResizeVideo24Filled />}
                    size="large"
                    onClick={() => setDialogIsOpen(true)}
                  />
                </Tooltip>
              </DialogTrigger>
              <DialogSurface>
                <DialogBody>
                  <DialogTitle>导出视频</DialogTitle>
                  <DialogContent>
                    <Field label="相机视角">
                      <RadioGroup
                        layout="horizontal"
                        value={camera}
                        onChange={(_, data) => setCamera(data.value as CameraType)}
                      >
                        <Radio label="前" value="f" />
                        <Radio label="后" value="b" />
                        <Radio label="左" value="l" />
                        <Radio label="右" value="r" />
                        {props.videos.some(video => video.src_lp?.path) ? <Radio label="左柱" value="lp" /> : null}
                        {props.videos.some(video => video.src_rp?.path) ? <Radio label="右柱" value="rp" /> : null}
                      </RadioGroup>
                    </Field>
                    <Field label="叠加">
                      <Checkbox
                        id={timestampId}
                        checked={withTimestamp}
                        label="时间戳"
                        onChange={(_, data) => setWithTimestamp(!!data.checked)}
                      />
                      <Checkbox
                        id={dashboardId}
                        checked={withDashboard}
                        label="仪表盘"
                        onChange={(_, data) => setWithDashboard(!!data.checked)}
                      />
                    </Field>
                    <Field label="导出文件目录">
                      <div className={styles.currentExportDir}>
                        当前选择：{exportDir}
                        <Button
                          appearance="transparent"
                          size="small"
                          onClick={() => selectExportDir()}
                        >选择目录
                        </Button>
                      </div>
                    </Field>
                  </DialogContent>
                  <DialogActions>
                    <DialogTrigger disableButtonEnhancement>
                      <Button
                        appearance="primary"
                        onClick={() => onConfirm()}
                      >确认导出
                      </Button>
                    </DialogTrigger>
                  </DialogActions>
                </DialogBody>
              </DialogSurface>
            </Dialog>
            <Toaster toasterId={toasterId} />
          </>
        ) : null
      }
      {tasks.length > 0 ? <ExportTask tasks={tasks} /> : null}
    </>
  )
}

export default FfmpegExport

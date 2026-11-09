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
import { open } from '@tauri-apps/plugin-dialog'
import { Command } from '@tauri-apps/plugin-shell'
import { getName } from '@tauri-apps/api/app'
import { resolveResource } from '@tauri-apps/api/path'
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

interface Run {
  t0: number
  t1: number
  sample: DashcamSample
}

const thinSamples = (samples: DashcamSample[]) => {
  if (!samples.length) return []
  const out = [samples[0]]
  let next = samples[0].time + 0.2
  for (const sample of samples) {
    if (sample.time + 0.0001 < next) continue
    out.push(sample)
    next = sample.time + 0.2
  }
  const last = samples[samples.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

const runsOf = (samples: DashcamSample[]): Run[] => {
  const runs: Run[] = []
  for (const sample of thinSamples(samples)) {
    const prev = runs[runs.length - 1]
    const changed = !prev
      || prev.sample.gear !== sample.gear
      || prev.sample.speedKmh !== sample.speedKmh
      || prev.sample.brake !== sample.brake
      || prev.sample.blinkerLeft !== sample.blinkerLeft
      || prev.sample.blinkerRight !== sample.blinkerRight
      || Math.abs(prev.sample.accelerator - sample.accelerator) >= 0.05
      || Math.abs(prev.sample.steeringDeg - sample.steeringDeg) >= 6
    if (!prev || changed) runs.push({ t0: sample.time, t1: sample.time, sample })
    else prev.t1 = sample.time
  }
  for (let i = 0; i < runs.length - 1; i++) runs[i].t1 = runs[i + 1].t0
  if (runs.length) {
    const end = samples[samples.length - 1].time + 0.2
    runs[runs.length - 1].t1 = Math.max(runs[runs.length - 1].t1, end)
  }
  return runs
}

const between = (t0: number, t1: number) => `between(t\\,${t0.toFixed(3)}\\,${t1.toFixed(3)})`

const angleExpr = (runs: Run[]) => {
  let expr = '0'
  for (let i = runs.length - 1; i >= 0; i--) {
    const rad = (runs[i].sample.steeringDeg * Math.PI / 180).toFixed(4)
    expr = `if(lt(t\\,${runs[i].t1.toFixed(3)})\\,${rad}\\,${expr})`
  }
  return expr
}

const chainFilters = (file: ExportFile, samples: DashcamSample[], options: OverlayOptions) => {
  const filters: string[] = []
  if (options.timestamp) {
    filters.push(`drawtext=fontsize=36:fontcolor=white:box=1:boxborderw=8:x=(w-text_w)/2:y=12:boxcolor=black@0.45:text='%{pts\\:localtime\\:${file.time / 1000}}'`)
  }
  if (!options.dashboard || !samples.length) return filters
  const runs = runsOf(samples)
  filters.push('drawbox=x=(iw-320)/2:y=56:w=320:h=96:color=white@0.35:t=fill')
  filters.push('drawtext=text=\'KM/H\':fontsize=16:fontcolor=0x8d8d8d:x=(w-text_w)/2:y=118')
  filters.push('drawtext=text=\'<\':fontsize=28:fontcolor=0x1a4a28:x=(w/2-150):y=78')
  filters.push('drawtext=text=\'>\':fontsize=28:fontcolor=0x1a4a28:x=(w/2+130):y=78')
  for (const run of runs) {
    const enable = `enable='${between(run.t0, run.t1)}'`
    filters.push(`drawtext=text='${run.sample.gear}':fontsize=32:fontcolor=black:x=(w/2-108):y=72:${enable}`)
    filters.push(`drawtext=text='${run.sample.speedKmh}':fontsize=40:fontcolor=black:x=(w-text_w)/2:y=68:${enable}`)
    const brake = run.sample.brake ? 'red' : '0xB0B0B0'
    filters.push(`drawtext=text='●':fontsize=20:fontcolor=${brake}:x=(w/2-112):y=112:${enable}`)
    const height = Math.max(4, Math.round(run.sample.accelerator * 22))
    filters.push(`drawbox=x=(w/2+96):y=${128 - height}:w=14:h=${height}:color=0x5c5c5c:t=fill:${enable}`)
    const flash = `enable='${between(run.t0, run.t1)}*lt(mod(t\\,1)\\,0.45)'`
    if (run.sample.blinkerLeft) {
      filters.push(`drawtext=text='<':fontsize=28:fontcolor=0x7dff6a:x=(w/2-150):y=78:${flash}`)
    }
    if (run.sample.blinkerRight) {
      filters.push(`drawtext=text='>':fontsize=28:fontcolor=0x7dff6a:x=(w/2+130):y=78:${flash}`)
    }
  }
  return filters
}

const exportArgs = async (
  files: ExportFile[],
  exportDir: string,
  fileName: string,
  options: OverlayOptions,
) => {
  const output = `${exportDir}/${fileName}`
  if (!options.timestamp && !options.dashboard) {
    if (files.length === 1) return ['-y', '-i', files[0].path, '-c', 'copy', output]
  }
  const samples = options.dashboard
    ? await Promise.all(files.map(file => loadDashcamSeiFile(file.path).catch(() => [] as DashcamSample[])))
    : files.map(() => [] as DashcamSample[])
  const args = ['-y']
  files.forEach(file => args.push('-i', file.path))
  const graphs: string[] = []
  files.forEach((file, index) => {
    const chain = chainFilters(file, samples[index], options)
    const useWheel = options.dashboard && samples[index].length > 0
    if (useWheel) {
      const dur = Math.max(1, Math.ceil(samples[index][samples[index].length - 1].time + 1))
      args.push('-f', 'lavfi', '-i', `color=c=0x00000000:s=48x48:r=30:d=${dur},format=rgba`)
      const wheelIndex = files.length + graphs.filter(item => item.includes('rotate=')).length
      graphs.push(`[${wheelIndex}:v]drawtext=text='O':fontsize=34:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2,rotate=a='${angleExpr(runsOf(samples[index]))}':ow=48:oh=48:c=none[wheel${index}]`)
    }
    const drawn = chain.length ? chain.join(',') : 'null'
    if (useWheel) {
      graphs.push(`[${index}:v]${drawn}[base${index}]`)
      graphs.push(`[base${index}][wheel${index}]overlay=x=(main_w-overlay_w)/2+78:y=64:eof_action=pass[v${index}]`)
    } else {
      graphs.push(`[${index}:v]${drawn}[v${index}]`)
    }
  })
  graphs.push(`${files.map((_, index) => `[v${index}]`).join('')}concat=n=${files.length}:v=1:a=0[v]`)
  args.push('-filter_complex', graphs.join(';'), '-map', '[v]', '-progress', '-', '-nostats', output)
  return args
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
  const command = Command.sidecar(
    'binaries/ffmpeg',
    await exportArgs(files, exportDir, fileName, options),
  )
  command.on('close', () => {
    log({
      name: fileName,
      path: filePath,
      exportDir,
      status: ExportStatusEnum.导出成功,
      log: 'success',
    })
  })
  command.on('error', error => {
    log({
      name: fileName,
      path: filePath,
      exportDir,
      status: ExportStatusEnum.导出失败,
      log: error,
    })
  })
  command.stdout.on('data', line => {
    log({
      name: fileName,
      path: filePath,
      exportDir,
      status: ExportStatusEnum.进行中,
      log: line,
    })
  })
  command.stderr.on('data', line => {
    log({
      name: fileName,
      path: filePath,
      exportDir,
      status: ExportStatusEnum.进行中,
      log: line,
    })
  })
  const child = await command.spawn()
  log({
    name: fileName,
    path: filePath,
    exportDir,
    status: ExportStatusEnum.进行中,
    log: `pid: ${child.pid}`,
  })
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
    const afterNoticePermission = await isPermissionGranted()
    if (!afterNoticePermission) {
      requestPermission()
    }
    doTask(
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
        if (existsIndex > -1) {
          temp.splice(existsIndex, 1, {
            ...temp[existsIndex],
            status,
            duration: duration ?? temp[existsIndex].duration,
            progress: progress ?? temp[existsIndex].progress,
            log: [...temp[existsIndex].log, log],
          })
        } else {
          temp.push({
            name,
            path: filePath,
            exportDir,
            status,
            duration: duration ?? 1,
            progress: 0,
            log: [log],
          })
        }
        if (status === ExportStatusEnum.导出成功) {
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
        if (status === ExportStatusEnum.导出失败) {
          dispatchToast(
            <Toast>
              <ToastTitle>
                提示
              </ToastTitle>
              <ToastBody>
                {exportDir} 导出失败
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
        tempTasks.current = temp
        setTasks(temp)
      },
    )
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
                        checked={withTimestamp}
                        label="时间戳"
                        onChange={(_, data) => setWithTimestamp(!!data.checked)}
                      />
                      <Checkbox
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

import { useState, useEffect } from 'react'
import cln from 'classnames'
import {
  makeStyles,
  shorthands,
  Tab,
  TabList,
  Divider,
  tokens,
  Tooltip,
  Button,
  Caption1Stronger,
  Badge,
} from '@fluentui/react-components'
import {
  Record24Regular, Code24Regular, BookQuestionMark24Regular,
} from '@fluentui/react-icons'
import Player from './components/player'
import DirectoryAccess from './components/directory-access'
import FfmpegTerminal from './components/ffmpeg-terminal'
import FfmpegExport from './components/ffmpeg-export'
import FsSystem from './components/fs-system'
import { isTauri } from '@tauri-apps/api/core'
import { TypeEnum, type ModelState, type OriginVideo } from './model'

const useStyles = makeStyles({
  root: {
    display: 'flex',
  },
  aside: {
    width: '330px',
    height: '100vh',
    backgroundColor: tokens.colorNeutralStroke3,
    display: 'flex',
    flexShrink: 0,
    flexDirection: 'column',
  },
  empty: {
    textAlign: 'center',
  },
  tabWrap: {
    alignItems: 'flex-start',
    display: 'flex',
    justifyContent: 'center',
    ...shorthands.padding('10px'),
    rowGap: '20px',
    flexShrink: 0,
  },
  menuWrap: {
    ...shorthands.padding('20px'),
    overflowY: 'auto',
    flexGrow: 1,
    display: 'flex',
    rowGap: '14px',
    flexDirection: 'column',
  },
  eventTag: {
    flexGrow: '1',
    textAlign: 'right',
  },
  menuItem: {
    ...shorthands.padding('6px', '16px'),
    ...shorthands.borderRadius('4px'),
    ...shorthands.transition('all', '120ms'),
    backgroundColor: tokens.colorNeutralBackground1,
    display: 'flex',
    alignItems: 'center',
    cursor: 'pointer',
    columnGap: '12px',
    color: tokens.colorNeutralForeground1,
    ':hover': {
      color: tokens.colorCompoundBrandStrokePressed,
    },
  },
  menuItemIsActive: {
    color: tokens.colorPaletteRedBorderActive,
    ':hover': {
      color: tokens.colorPaletteRedBorderActive,
    },
  },
  menuItemIsSelected: {
    backgroundColor: tokens.colorBrandBackground2,
  },
  content: {
    height: '100vh',
    ...shorthands.overflow('hidden', 'auto'),
    flexGrow: 1,
    backgroundColor: tokens.colorSubtleBackgroundHover,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    ...shorthands.padding('20px'),
  },
  headerLeft: {
    ...shorthands.gap('10px'),
    display: 'flex',
  },
  headerRight: {
    ...shorthands.gap('10px'),
    display: 'flex',
    alignItems: 'center',
  },
  link: {
    color: 'inherit',
    '&:active': {
      color: 'inherit',
    },
  },
  player: {
    flexGrow: 1,
    minHeight: '1px',
    boxSizing: 'border-box',
    display: 'flex',
    justifyContent: 'center',
  },
})

function CameraLayoutIcon({ six }: { six: boolean }) {
  const tiles = six
    ? [[4.5, 3], [13.5, 3], [4.5, 9.5], [13.5, 9.5], [4.5, 16], [13.5, 16]]
    : [[3.5, 3.5], [13, 3.5], [3.5, 13], [13, 13]]
  const size = six ? 6 : 7.5
  return (
    <svg aria-hidden="true" height="24" viewBox="0 0 24 24" width="24">
      {tiles.map(([x, y]) => (
        <rect
          key={`${x}-${y}`}
          fill="none"
          height={size}
          rx="1.2"
          stroke="currentColor"
          strokeWidth="1.5"
          width={size}
          x={x}
          y={y}
        />
      ))}
    </svg>
  )
}

const tabs = [
  {
    name: '所有',
    value: TypeEnum.所有,
  },
  {
    name: '保存',
    value: TypeEnum.保存,
  },
  {
    name: '哨兵',
    value: TypeEnum.哨兵,
  },
  {
    name: '记录仪',
    value: TypeEnum.行车记录仪,
  },
]

function App() {
  const styles = useStyles()
  const [filterType, setFilterType] = useState(TypeEnum.所有)
  const [scanError, setScanError] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [sixCamera, setSixCamera] = useState(false)
  const [state, setState] = useState<ModelState>({
    type: TypeEnum.所有,
    list: [],
    events: [],
  })
  useEffect(() => {
    const current = state.current
    if (!current) return
    if (!sixCamera) {
      if (!current.src_lp && !current.src_rp) return
      if (current.src_lp) URL.revokeObjectURL(current.src_lp)
      if (current.src_rp) URL.revokeObjectURL(current.src_rp)
      setState(prev => prev.current ? {
        ...prev,
        current: {
          ...prev.current,
          src_lp: undefined,
          src_lp_name: undefined,
          src_lp_path: undefined,
          src_rp: undefined,
          src_rp_name: undefined,
          src_rp_path: undefined,
        },
      } : prev)
      return
    }
    if (current.src_lp || current.src_rp) return
    const origin = state.list.find(item => item.id === current.id)
    if (!origin?.src_lp && !origin?.src_rp) return
    let alive = true
    Promise.all([origin.src_lp?.get(), origin.src_rp?.get()]).then(([left, right]) => {
      if (!alive) {
        if (left?.url) URL.revokeObjectURL(left.url)
        if (right?.url) URL.revokeObjectURL(right.url)
        return
      }
      setState(prev => {
        if (!prev.current || prev.current.id !== current.id) return prev
        return {
          ...prev,
          current: {
            ...prev.current,
            src_lp: left?.url,
            src_lp_name: left?.name,
            src_lp_path: origin.src_lp?.path,
            src_rp: right?.url,
            src_rp_name: right?.name,
            src_rp_path: origin.src_rp?.path,
          },
        }
      })
    })
    return () => {
      alive = false
    }
  }, [sixCamera, state.current?.id])
  useEffect(() => {
    document.onkeydown = (e: KeyboardEvent) => {
      if (e.code == 'Space') {
        e.preventDefault()
      }
    }
    return () => {
      document.onkeydown = null
    }
  }, [])
  function onFileSystemAccess(videos: OriginVideo[]) {
    setScanError('')
    setSelectedIds([])
    setState({
      ...state,
      list: videos,
    })
  }
  function onItemClick(event: React.MouseEvent, id: string) {
    if (event.metaKey || event.altKey) {
      setSelectedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
      return
    }
    setSelectedIds([id])
    onSelectVideo(id)
  }
  async function onSelectVideo(id: string) {
    if (state.current) {
      const {
        src_f, src_b, src_l, src_r, src_lp, src_rp,
      } = state.current
      URL.revokeObjectURL(src_f)
      URL.revokeObjectURL(src_b)
      URL.revokeObjectURL(src_l)
      URL.revokeObjectURL(src_r)
      if (src_lp) URL.revokeObjectURL(src_lp)
      if (src_rp) URL.revokeObjectURL(src_rp)
    }
    const origin = state.list.find(item => item.id === id)
    if (!origin) return
    const [
      src_f_file,
      src_b_file,
      src_l_file,
      src_r_file,
      src_lp_file,
      src_rp_file,
    ] = await Promise.all([
      origin.src_f.get(),
      origin.src_b.get(),
      origin.src_l.get(),
      origin.src_r.get(),
      sixCamera ? origin.src_lp?.get() : undefined,
      sixCamera ? origin.src_rp?.get() : undefined,
    ])
    setState({
      ...state,
      current: {
        ...origin,
        src_f: src_f_file.url,
        src_f_name: src_f_file.name,
        src_f_path: origin.src_f.path,
        src_b: src_b_file.url,
        src_b_name: src_b_file.name,
        src_b_path: origin.src_b.path,
        src_l: src_l_file.url,
        src_l_name: src_l_file.name,
        src_l_path: origin.src_l.path,
        src_r: src_r_file.url,
        src_r_name: src_r_file.name,
        src_r_path: origin.src_r.path,
        src_lp: src_lp_file?.url,
        src_lp_name: src_lp_file?.name,
        src_lp_path: src_lp_file ? origin.src_lp?.path : undefined,
        src_rp: src_rp_file?.url,
        src_rp_name: src_rp_file?.name,
        src_rp_path: src_rp_file ? origin.src_rp?.path : undefined,
      },
    })
  }
  const videoList = state.list
    .filter(({ type }) => type === filterType || filterType === TypeEnum.所有)
    .sort((a, b) => b.time - a.time)
  const selectedVideos = state.list
    .filter(item => selectedIds.includes(item.id))
    .sort((a, b) => a.time - b.time)
  return (
    <>
      <div className={styles.root}>
        <div className={styles.aside}>
          <div>
            <div className={styles.tabWrap}>
              <TabList
                selectedValue={filterType}
                onTabSelect={(_, data) => setFilterType(data.value as TypeEnum)}
              >
                {
                  tabs.map(({ name, value }) => (
                    <Tab key={value} value={value}>{name}</Tab>
                  ))
                }
              </TabList>
            </div>
            <Divider />
          </div>
          <div className={styles.menuWrap}>
            {
              videoList.map((item) => (
                <div
                  className={cln(styles.menuItem, {
                    [styles.menuItemIsActive]: item.id === state.current?.id,
                    [styles.menuItemIsSelected]: selectedIds.includes(item.id),
                  })}
                  key={item.id}
                  onClick={event => onItemClick(event, item.id)}
                  onKeyDown={(e) => {
                    e.preventDefault()
                  }}
                  onKeyUp={(e) => {
                    e.preventDefault()
                  }}
                >
                  <Record24Regular />
                  {item.title}
                  <div className={styles.eventTag}>
                    {item.event ? <Badge color="danger" size="extra-small" /> : null}
                  </div>
                </div>
              ))
            }
            {!videoList.length && <div className={styles.empty}>{scanError || '暂无数据'}</div>}
          </div>
        </div>
        <div className={styles.content}>
          <div className={styles.header}>
            <div className={styles.headerLeft}>
              {isTauri()
                ? <FsSystem onAccess={onFileSystemAccess} onError={setScanError} />
                : <DirectoryAccess onAccess={onFileSystemAccess} />}
              {isTauri() && selectedVideos.length
                ? <FfmpegExport videos={selectedVideos} />
                : <FfmpegTerminal video={state.current} />}
            </div>
            <div className={styles.headerRight}>
              <Tooltip content={sixCamera ? '切换为四路' : '切换为六路'} relationship="label">
                <Button
                  icon={<CameraLayoutIcon six={sixCamera} />}
                  onClick={() => setSixCamera(value => !value)}
                />
              </Tooltip>
              <Tooltip
                content={<>查看源代码 (本项目<Caption1Stronger>不会上传</Caption1Stronger>您的隐私视频，并且接受公开的代码审查)</>}
                relationship="label"
              >
                <Button
                  icon={
                    <a
                      className={styles.link}
                      href="https://github.com/Mario34/tesla-camera"
                      rel="noreferrer"
                      target="_blank"
                    >
                      <Code24Regular />
                    </a>
                  }
                />
              </Tooltip>
              <Tooltip content={<>问题反馈</>} relationship="label">
                <Button
                  icon={
                    <a
                      className={styles.link}
                      href="https://github.com/Mario34/tesla-camera/issues/new?assignees=Mario34&labels=&template=%E6%84%8F%E8%A7%81%E6%88%96%E5%8F%8D%E9%A6%88.md&title=%E6%84%8F%E8%A7%81%E6%88%96%E5%8F%8D%E9%A6%88"
                      rel="noreferrer"
                      target="_blank"
                    >
                      <BookQuestionMark24Regular />
                    </a>
                  }
                />
              </Tooltip>
            </div>
          </div>
          <div className={styles.player}>
            <Player key={state.current?.id} sixCamera={sixCamera} video={state.current} />
          </div>
        </div>
      </div>
    </>
  )
}

export default App

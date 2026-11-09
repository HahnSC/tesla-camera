import React, { useEffect, useState, useRef } from 'react'
import {
  makeStyles,
  shorthands,
  tokens,
  Slider,
} from '@fluentui/react-components'
import { Pause24Filled, Play24Filled } from '@fluentui/react-icons'
import MiniPlay from './mini-player'
import SpeedPanel from './telemetry-hud'
import dayjs from 'dayjs'
import { isTauri } from '@tauri-apps/api/core'
import { useDelayPlay } from '../tool'
import { loadDashcamSei, loadDashcamSeiFile, type DashcamSample } from '../dashcam-sei'

import { type Video, CameraEnum } from '../model'

const useStyles = makeStyles({
  root: {
    ...shorthands.padding(0, '20px'),
  },
  videoWrap: {
    display: 'block',
    position: 'relative',
    width: 'fit-content',
    maxWidth: '100%',
    marginLeft: 'auto',
    marginRight: 'auto',
    overflow: 'hidden',
  },
  picture: {
    position: 'absolute',
    zIndex: 3,
    pointerEvents: 'none',
  },
  video: {
    display: 'block',
    width: '800px',
    height: '600px',
    objectFit: 'contain',
    backgroundColor: tokens.colorNeutralBackground5Selected,
    '@media screen and (min-width: 1440px)': {
      width: '1000px',
      height: '750px',
    },
    '@media screen and (min-width: 1680px)': {
      width: '1200px',
      height: '900px',
    },
  },
  time: {
    position: 'absolute',
    top: '6px',
    left: '6px',
    zIndex: 5,
    textAlign: 'left',
    maxWidth: 'calc(100% - 12px)',
    boxSizing: 'border-box',
    color: tokens.colorNeutralBackground1Hover,
    fontSize: '14px',
    fontWeight: 500,
    ...shorthands.padding('2px', '6px'),
    letterSpacing: '0',
    backgroundColor: tokens.colorNeutralStencil1Alpha,
    ...shorthands.borderRadius('2px'),
  },
  controlWrap: {
    display: 'flex',
    alignItems: 'center',
    ...shorthands.gap('10px'),
  },
  slider: {
    flexGrow: 1,
  },
  sliderTime: {
    minWidth: '40px',
    textAlign: 'center',
  },
  iconButton: {
    cursor: 'pointer',
    ':active': {
      color: tokens.colorNeutralForeground2,
    },
  },
  empty: {

  },
  playFocusInput: {
    opacity: 0,
    position: 'fixed',
    top: '-100vh',
    left: '-100vw',
  },
})

interface PlayerProps {
  video?: Video
  sixCamera?: boolean
}

function getSrc(camera: CameraEnum, video: Video): string {
  switch (camera) {
    case CameraEnum.前:
      return video.src_f
    case CameraEnum.后:
      return video.src_b
    case CameraEnum.左:
      return video.src_l
    case CameraEnum.右:
      return video.src_r
    case CameraEnum.左柱:
      return video.src_lp ?? ''
    case CameraEnum.右柱:
      return video.src_rp ?? ''
  }
}

function fmtTime(time: number) {
  const total = Math.max(0, Math.floor(time))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

const Player: React.FC<React.PropsWithChildren<PlayerProps>> = (props) => {
  const styles = useStyles()
  const [currentCamera, setCurrentCamera] = useState(CameraEnum.前)
  const [currentTime, setCurrentTime] = useState(CameraEnum.前)
  const [paused, setPaused] = useState(true)
  const [duration, setDuration] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const inputIsFocus = useRef(false)
  const [picture, setPicture] = useState({ top: 0, left: 0, width: 0, height: 0 })
  const [samples, setSamples] = useState<DashcamSample[]>([])
  useEffect(() => {
    if (!props.video) {
      setSamples([])
      return
    }
    let alive = true
    const filePath = props.video.src_f_path
    const url = props.video.src_f
    const load = isTauri() && filePath
      ? loadDashcamSeiFile(filePath)
      : loadDashcamSei(url)
    load.then(list => {
      if (alive) setSamples(list)
    }).catch(() => {
      if (alive) setSamples([])
    })
    return () => {
      alive = false
    }
  }, [props.video])
  useEffect(() => {
    if (props.sixCamera) return
    if (currentCamera !== CameraEnum.左柱 && currentCamera !== CameraEnum.右柱) return
    onSelectCamera(CameraEnum.前)
  }, [props.sixCamera])
  const { delayPlay } = useDelayPlay()
  function onKeyUp(e: Parameters<React.KeyboardEventHandler>[0]) {
    e.preventDefault()
    switch (e.code) {
      case 'Space':
        if (videoRef.current?.paused) {
          play()
        } else {
          pause()
        }
        break
      case 'KeyW':
        onSelectCamera(CameraEnum.前)
        break
      case 'KeyS':
        onSelectCamera(CameraEnum.后)
        break
      case 'KeyA':
        onSelectCamera(CameraEnum.左)
        break
      case 'KeyD':
        onSelectCamera(CameraEnum.右)
        break
      case 'KeyQ':
        if (props.sixCamera) onSelectCamera(CameraEnum.左柱)
        break
      case 'KeyE':
        if (props.sixCamera) onSelectCamera(CameraEnum.右柱)
        break
      default:
      //
    }
  }
  function onSelectCamera(val: CameraEnum) {
    if (!videoRef.current || !props.video) return
    const src = getSrc(val, props.video)
    if (!src) return
    setCurrentCamera(val)
    const prePaused = videoRef.current.paused
    const currentTime = videoRef.current.currentTime
    videoRef.current.pause()
    videoRef.current.src = src
    videoRef.current.currentTime = currentTime
    if (!prePaused) {
      delayPlay(videoRef.current)
    }
  }
  function onTimeupdate() {
    if (!videoRef.current) return
    if (videoRef.current.currentTime >= videoRef.current.duration) {
      setCurrentTime(0)
      videoRef.current.pause()
    } else {
      setCurrentTime(videoRef.current.currentTime)
    }
  }
  function play() {
    if (!videoRef.current) return
    videoRef.current.play()
    setPaused(false)
  }
  function pause() {
    if (!videoRef.current) return
    videoRef.current.pause()
    setPaused(true)
  }
  function measurePicture() {
    const video = videoRef.current
    if (!video?.videoWidth || !video?.videoHeight) return
    const boxWidth = video.clientWidth
    const boxHeight = video.clientHeight
    const videoRatio = video.videoWidth / video.videoHeight
    const boxRatio = boxWidth / boxHeight
    const width = Math.round(videoRatio > boxRatio ? boxWidth : boxHeight * videoRatio)
    const height = Math.round(videoRatio > boxRatio ? boxWidth / videoRatio : boxHeight)
    const top = Math.round((boxHeight - height) / 2)
    const left = Math.round((boxWidth - width) / 2)
    setPicture(prev => (
      prev.top === top && prev.left === left && prev.width === width && prev.height === height
        ? prev
        : { top, left, width, height }
    ))
  }
  function onLoadedMetadata() {
    if (!videoRef.current) return
    setDuration(videoRef.current.duration)
    measurePicture()
  }
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    measurePicture()
    const observer = new ResizeObserver(measurePicture)
    observer.observe(video)
    return () => observer.disconnect()
  }, [props.video, currentCamera])
  function onSeek(val: number) {
    if (!videoRef.current) return
    const prePaused = videoRef.current.paused
    videoRef.current.pause()
    setCurrentTime(val)
    videoRef.current.currentTime = val
    if (!prePaused) {
      delayPlay(videoRef.current)
    }
  }
  function onPlayFocus() {
    inputIsFocus.current = true
  }
  function onPlayBlur() {
    inputIsFocus.current = false
  }
  return (
    <div className={styles.root}>
      {
        props.video ? (
          <div className={styles.root}>
            <label className={styles.videoWrap} htmlFor="player-focus-input">
              <video
                muted
                className={styles.video}
                id="player"
                ref={videoRef}
                onLoadedMetadata={onLoadedMetadata}
                onPause={() => setPaused(true)}
                onPlay={() => setPaused(false)}
                onTimeUpdate={onTimeupdate}
              >
                <source src={getSrc(currentCamera, props.video)} type="video/mp4" />
              </video>
              {
                  (props.sixCamera
                    ? [CameraEnum.前, CameraEnum.后, CameraEnum.左柱, CameraEnum.右柱, CameraEnum.左, CameraEnum.右]
                    : [CameraEnum.前, CameraEnum.后, CameraEnum.左, CameraEnum.右])
                    .filter(camera => getSrc(camera, props.video!))
                    .map(camera => (
                      <MiniPlay
                        camera={camera}
                        currentTime={currentTime}
                        isActive={currentCamera === camera}
                        key={camera}
                        paused={paused}
                        src={getSrc(camera, props.video!)}
                        onClick={() => onSelectCamera(camera)}
                      />
                    ))
                }
              {picture.height > 0 && (
              <div
                className={styles.picture}
                style={{
                  top: picture.top,
                  left: picture.left,
                  width: picture.width,
                  height: picture.height,
                }}
              >
                <div className={styles.time}>
                  {dayjs(props.video.time + currentTime * 1000).format('YYYY年MM月DD日 HH:mm:ss')}
                </div>
                <SpeedPanel samples={samples} videoRef={videoRef} />
              </div>
              )}
            </label>
            <div className={styles.controlWrap}>
              {
                  paused
                    ? <Play24Filled
                        className={styles.iconButton}
                        onClick={play}
                      />
                    : <Pause24Filled
                        className={styles.iconButton}
                        onClick={pause}
                      />
                }
              <div className={styles.sliderTime}>{fmtTime(currentTime)}</div>
              <Slider
                className={styles.slider}
                max={duration}
                min={0}
                value={currentTime}
                onChange={(_, data) => onSeek(data.value)}
              />
              <div className={styles.sliderTime}>{fmtTime(duration)}</div>
            </div>
            <input
              autoFocus
              className={styles.playFocusInput}
              id="player-focus-input"
              onBlur={onPlayBlur}
              onFocus={onPlayFocus}
              onKeyUp={onKeyUp}
            />
          </div>
        ) : (
          <div className={styles.empty}>
            暂无数据
          </div>
        )
      }

    </div>
  )
}

export default Player

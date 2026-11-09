import React, { useRef, useEffect } from 'react'
import { makeStyles, tokens, shorthands } from '@fluentui/react-components'
import cls from 'classnames'
import { CameraEnum } from '../model'

interface MiniPlayProps {
  currentTime: number
  src: string
  camera: number
  isActive: boolean
  paused: boolean
  onClick: () => void
}

const useStyles = makeStyles({
  root: {
    position: 'absolute',
    height: '120px',
    width: '160px',
    cursor: 'pointer',
    backgroundColor: tokens.colorSubtleBackgroundInvertedHover,
    ...shorthands.borderRadius('6px'),
    ...shorthands.overflow('hidden'),
    '&.c0': {
      top: '30px',
      left: '30px',
    },
    '&.c1': {
      top: '30px',
      right: '30px',
    },
    '&.c2': {
      bottom: '30px',
      left: '30px',
    },
    '&.c3': {
      bottom: '30px',
      right: '30px',
    },
    '&.c4': {
      top: '50%',
      left: '30px',
      transform: 'translateY(-50%)',
    },
    '&.c5': {
      top: '50%',
      right: '30px',
      transform: 'translateY(-50%)',
    },
  },
  video: {
    height: '100%',
    width: '100%',
    '&.is-hidden': {
      opacity: 0,
    },
  },
  name: {
    position: 'absolute',
    bottom: '6px',
    left: '6px',
    color: tokens.colorNeutralBackground1Hover,
    fontWeight: '500',
  },
})

const MiniPlay: React.FC<MiniPlayProps> = (props) => {
  const {
    camera,
    currentTime,
    isActive,
    onClick,
    paused,
    src,
  } = props
  const styles = useStyles()
  const videoRef = useRef<HTMLVideoElement>(null)
  const playTimerRef = useRef<number | null>(null)
  useEffect(() => {
    const video = videoRef.current
    return () => {
      if (!video) return
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [])
  useEffect(() => {
    if (!videoRef.current) return
    if (paused && !videoRef.current.paused) {
      videoRef.current.pause()
    }
    if (!paused && videoRef.current.paused) {
      videoRef.current.currentTime = currentTime
      if (playTimerRef.current) {
        clearTimeout(playTimerRef.current)
      }
      playTimerRef.current = setTimeout(() => {
        videoRef.current?.play()
        playTimerRef.current = null
      }, 200)
    }
  }, [currentTime, paused])
  useEffect(() => {
    if (!videoRef.current) return
    if (paused) {
      videoRef.current.currentTime = currentTime
    }
  }, [currentTime, paused])
  return (
    <div
      className={cls(styles.root, `c${camera}`)}
      onClick={onClick}
    >
      <span className={styles.name}>{CameraEnum[camera]}</span>
      <video
        muted
        className={cls(styles.video, { 'is-hidden': isActive })}
        preload="auto"
        ref={videoRef}
        src={src}
      />
    </div>
  )
}

export default MiniPlay

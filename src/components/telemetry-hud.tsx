import React, { useEffect, useState } from 'react'
import { makeStyles } from '@fluentui/react-components'
import { type DashcamSample, sampleAt } from '../dashcam-sei'

interface SpeedPanelProps {
  samples: DashcamSample[]
  videoRef: React.RefObject<HTMLVideoElement | null>
}

const useStyles = makeStyles({
  row: {
    position: 'absolute',
    top: '0',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 4,
    pointerEvents: 'none',
    display: 'flex',
    alignItems: 'center',
    columnGap: '10px',
  },
  card: {
    display: 'grid',
    gridTemplateColumns: '28px auto 28px',
    gridTemplateRows: 'auto auto',
    columnGap: '16px',
    rowGap: '2px',
    alignItems: 'center',
    justifyItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: '16px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.12)',
    padding: '8px 16px 10px',
    color: '#1b1b1b',
    userSelect: 'none',
  },
  gear: {
    gridColumn: '1',
    gridRow: '1',
    fontSize: '22px',
    fontWeight: 700,
    lineHeight: 1,
  },
  speed: {
    gridColumn: '2',
    gridRow: '1',
    fontSize: '26px',
    fontWeight: 700,
    lineHeight: 1,
    fontVariantNumeric: 'tabular-nums',
  },
  unit: {
    gridColumn: '2',
    gridRow: '2',
    fontSize: '11px',
    lineHeight: 1,
    letterSpacing: '0.08em',
    color: '#8d8d8d',
  },
  wheel: {
    gridColumn: '3',
    gridRow: '1',
    width: '22px',
    height: '22px',
    display: 'flex',
    transformOrigin: 'center',
  },
  blinker: {
    width: '22px',
    height: '18px',
    color: '#1a4a28',
  },
  blinkerLit: {
    color: '#7dff6a',
  },
  wheelOn: {
    color: '#2f7cf6',
  },
  wheelOff: {
    color: '#8a8a8a',
  },
  brake: {
    gridColumn: '1',
    gridRow: '2',
    width: '16px',
    height: '16px',
    borderRadius: '50%',
  },
  brakeOn: {
    backgroundColor: '#ff3b30',
  },
  brakeOff: {
    backgroundColor: '#d5d5d5',
  },
  accel: {
    gridColumn: '3',
    gridRow: '2',
    width: '16px',
    height: '16px',
    borderRadius: '50%',
    backgroundColor: '#d5d5d5',
    overflow: 'hidden',
    position: 'relative',
  },
  accelFill: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#5c5c5c',
  },
})

function sameSample(prev: DashcamSample | null, next: DashcamSample | null): boolean {
  if (prev === next) return true
  if (!prev || !next) return false
  return prev.gear === next.gear
    && prev.speedKmh === next.speedKmh
    && prev.brake === next.brake
    && prev.autopilot === next.autopilot
    && prev.blinkerLeft === next.blinkerLeft
    && prev.blinkerRight === next.blinkerRight
    && Math.abs(prev.steeringDeg - next.steeringDeg) < 0.5
    && Math.abs(prev.accelerator - next.accelerator) < 0.01
}

function BlinkerIcon({ left }: { left: boolean }) {
  return (
    <svg aria-hidden="true" height="18" viewBox="0 0 22 18" width="22">
      {left
        ? <path d="M13 1 3 9l10 8V12h7V6h-7V1Z" fill="currentColor" />
        : <path d="M9 1l10 8-10 8V12H2V6h7V1Z" fill="currentColor" />}
    </svg>
  )
}

function SteeringIcon() {
  return (
    <svg aria-hidden="true" height="22" viewBox="0 0 24 24" width="22">
      <circle cx="12" cy="12" fill="none" r="8.4" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.1 12h4.1M15.8 12h4.1M12 15.4v4.1" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <circle cx="12" cy="12" fill="currentColor" r="1.7" />
    </svg>
  )
}

const SpeedPanel: React.FC<SpeedPanelProps> = ({ samples, videoRef }) => {
  const styles = useStyles()
  const [sample, setSample] = useState<DashcamSample | null>(null)
  const [blinkerLit, setBlinkerLit] = useState(false)

  useEffect(() => {
    if (samples.length === 0) {
      setSample(null)
      return
    }
    let frame = 0
    let stop = false
    const tick = () => {
      if (stop) return
      const time = videoRef.current?.currentTime ?? 0
      const next = Number.isFinite(time) ? sampleAt(samples, time) : null
      setSample(prev => sameSample(prev, next) ? prev : next)
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      stop = true
      cancelAnimationFrame(frame)
    }
  }, [samples, videoRef])
  useEffect(() => {
    let offTimer = 0
    const flash = () => {
      setBlinkerLit(true)
      offTimer = window.setTimeout(() => setBlinkerLit(false), 400)
    }
    flash()
    const timer = window.setInterval(flash, 1000)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(offTimer)
    }
  }, [])

  if (!sample) return null
  const accelerator = Math.round(sample.accelerator * 100)
  return (
    <div className={styles.row}>
      <div className={`${styles.blinker} ${sample.blinkerLeft && blinkerLit ? styles.blinkerLit : ''}`}>
        <BlinkerIcon left />
      </div>
      <div className={styles.card}>
        <div className={styles.gear}>{sample.gear}</div>
        <div className={styles.speed}>{sample.speedKmh}</div>
        <div
          className={`${styles.wheel} ${sample.autopilot ? styles.wheelOn : styles.wheelOff}`}
          style={{ transform: `rotate(${sample.steeringDeg}deg)` }}
        >
          <SteeringIcon />
        </div>
        <div className={`${styles.brake} ${sample.brake ? styles.brakeOn : styles.brakeOff}`} />
        <div className={styles.unit}>KM/H</div>
        <div className={styles.accel}>
          <div className={styles.accelFill} style={{ height: `${accelerator}%` }} />
        </div>
      </div>
      <div className={`${styles.blinker} ${sample.blinkerRight && blinkerLit ? styles.blinkerLit : ''}`}>
        <BlinkerIcon left={false} />
      </div>
    </div>
  )
}

export default SpeedPanel

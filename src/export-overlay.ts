import { type DashcamSample } from './dashcam-sei'

interface ExportFile {
  path: string
  time: number
}

interface Run {
  t0: number
  t1: number
  sample: DashcamSample
}

export interface ExportOverlayOptions {
  timestamp: boolean
  dashboard: boolean
}

// Player draws the HUD in CSS pixels over an 800x600 box. This aspect fits at 518px tall.
const REF = 518

const isWindows = /Windows/i.test(navigator.userAgent) || navigator.platform === 'Win32'

const fontFile = (bold: boolean) => {
  if (isWindows) return `fontfile=C\\\\:/Windows/Fonts/${bold ? 'arialbd.ttf' : 'arial.ttf'}:`
  const name = bold ? 'Arial Bold.ttf' : 'Arial.ttf'
  return `fontfile='/System/Library/Fonts/Supplemental/${name}':`
}

const between = (t0: number, t1: number) => `between(t\\,${t0.toFixed(3)}\\,${t1.toFixed(3)})`

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
      || prev.sample.autopilot !== sample.autopilot
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

const anglePoints = (samples: DashcamSample[]) => {
  const cap = 56
  const raw: { t: number, rad: number }[] = []
  let lastDeg = Number.NaN
  for (const sample of samples) {
    if (!Number.isFinite(lastDeg) || Math.abs(sample.steeringDeg - lastDeg) >= 1.5) {
      raw.push({ t: sample.time, rad: sample.steeringDeg * Math.PI / 180 })
      lastDeg = sample.steeringDeg
    }
  }
  const end = samples[samples.length - 1]
  if (end && raw.length && raw[raw.length - 1].t !== end.time) {
    raw.push({ t: end.time, rad: end.steeringDeg * Math.PI / 180 })
  }
  if (raw.length <= cap) return raw
  const keep = new Set<number>([0, raw.length - 1])
  const ranked = raw.map((point, index) => {
    if (index === 0 || index === raw.length - 1) return { index, score: -1 }
    return { index, score: Math.abs(point.rad - raw[index - 1].rad) + Math.abs(raw[index + 1].rad - point.rad) }
  }).filter(item => item.score >= 0).sort((a, b) => b.score - a.score)
  for (const item of ranked) {
    if (keep.size >= cap) break
    keep.add(item.index)
  }
  return raw.filter((_, index) => keep.has(index))
}

// Linear blend between samples. Nested ifs past ~80 make ffmpeg write a 0-byte file.
const angleExpr = (samples: DashcamSample[]) => {
  const points = anglePoints(samples)
  if (!points.length) return '0'
  let expr = points[points.length - 1].rad.toFixed(4)
  for (let i = points.length - 2; i >= 0; i--) {
    const t0 = points[i].t
    const t1 = points[i + 1].t
    const span = Math.max(0.001, t1 - t0)
    const a0 = points[i].rad
    const a1 = points[i + 1].rad
    expr = `if(lt(t\\,${t1.toFixed(3)})\\,${a0.toFixed(4)}+(${(a1 - a0).toFixed(4)})*(t-${t0.toFixed(3)})/${span.toFixed(3)}\\,${expr})`
  }
  return expr
}

const enableOf = (runs: Run[], pick: (run: Run) => boolean) => {
  const parts = runs.filter(pick).map(run => between(run.t0, run.t1))
  return parts.length ? parts.join('+') : ''
}

const accelStep = (sample: DashcamSample) => Math.max(0, Math.min(20, Math.round(sample.accelerator * 20)))

export const overlayAssetNames = [
  'card', 'wheel', 'wheel-ap',
  'blink-l', 'blink-l-on', 'blink-r', 'blink-r-on',
  'brake-off', 'brake-on',
  ...Array.from({ length: 21 }, (_, step) => `accel-${String(step).padStart(2, '0')}`),
]

const ffmpegPath = (filePath: string) => filePath.replace(/\\/g, '/')

export const parseVideoSize = (log: string) => {
  const match = log.match(/Video:.*?(\d{2,5})x(\d{2,5})/)
  if (!match) return { width: 0, height: 0 }
  return { width: Number(match[1]), height: Number(match[2]) }
}

const px = (height: number, css: number) => Math.max(1, Math.round(css * (height > 0 ? height : REF) / REF))

export const buildFfmpegArgs = (input: {
  files: ExportFile[]
  output: string
  options: ExportOverlayOptions
  samples: DashcamSample[][]
  sizes: { width: number, height: number }[]
  assets: Record<string, string>
}) => {
  const output = ffmpegPath(input.output)
  const { files, options, samples, assets, sizes } = input
  if (!options.timestamp && !options.dashboard) {
    if (files.length === 1) return ['-y', '-i', ffmpegPath(files[0].path), '-c', 'copy', output]
  }
  const args = ['-y']
  files.forEach(file => args.push('-i', ffmpegPath(file.path)))
  const dash = files.map((_, index) => options.dashboard && samples[index].length > 0)
  const runsList = files.map((_, index) => dash[index] ? runsOf(samples[index]) : [])
  const needed = new Set<string>()
  if (dash.some(Boolean)) {
    needed.add('card')
    needed.add('wheel')
    needed.add('blink-l')
    needed.add('blink-r')
    needed.add('brake-off')
    runsList.forEach(runs => {
      if (runs.some(run => run.sample.autopilot)) needed.add('wheel-ap')
      if (runs.some(run => run.sample.brake)) needed.add('brake-on')
      if (runs.some(run => run.sample.blinkerLeft)) needed.add('blink-l-on')
      if (runs.some(run => run.sample.blinkerRight)) needed.add('blink-r-on')
      runs.forEach(run => needed.add(`accel-${String(accelStep(run.sample)).padStart(2, '0')}`))
    })
  }
  const duration = Math.max(1, ...runsList.map(runs => runs.length ? Math.ceil(runs[runs.length - 1].t1 + 1) : 1))
  const padOf = new Map<string, string>()
  needed.forEach(name => {
    const index = files.length + padOf.size
    padOf.set(name, `${index}:v`)
    args.push('-loop', '1', '-framerate', '60', '-t', String(duration), '-i', ffmpegPath(assets[name]))
  })

  const graphs: string[] = []
  const branch = (pad: string, count: number, tag: string) => {
    if (count <= 1) return [pad]
    const outs = Array.from({ length: count }, (_, index) => `${tag}${index}`)
    graphs.push(`[${pad}]split=${count}${outs.map(name => `[${name}]`).join('')}`)
    return outs
  }
  const copies = dash.filter(Boolean).length
  const assetBranch = (name: string, tag: string) => {
    const pad = padOf.get(name)
    return pad ? branch(pad, copies, tag) : []
  }
  const card = assetBranch('card', 'card')
  const wheel = assetBranch('wheel', 'wheel')
  const wheelAp = assetBranch('wheel-ap', 'wap')
  const blinkL = assetBranch('blink-l', 'bl')
  const blinkLOn = assetBranch('blink-l-on', 'blo')
  const blinkR = assetBranch('blink-r', 'br')
  const blinkROn = assetBranch('blink-r-on', 'bro')
  const brakeOff = assetBranch('brake-off', 'bof')
  const brakeOn = assetBranch('brake-on', 'bon')
  const accel = Array.from({ length: 21 }, (_, step) => assetBranch(`accel-${String(step).padStart(2, '0')}`, `ac${step}`))

  let dashSlot = 0
  const labels = files.map((file, index) => {
    const runs = dash[index] ? runsOf(samples[index]) : []
    let label = `${index}:v`
    const text: string[] = []
    const height = sizes[index]?.height ?? 0
    const n = (css: number) => px(height, css)
    if (options.timestamp) {
      text.push(`drawtext=${fontFile(false)}fontsize=${n(14)}:fontcolor=white:box=1:boxborderw=${n(3)}:boxcolor=black@0.45:x=${n(6)}:y=${n(6)}:text='%{pts\\:localtime\\:${file.time / 1000}}'`)
    }
    if (dash[index]) {
      const slot = dashSlot
      dashSlot += 1
      const cardOut = `cardf${index}`
      graphs.push(`[${card[slot]}]scale=${n(172)}:${n(62)}:flags=lanczos,format=rgba[${cardOut}]`)
      const covered = `cov${index}`
      graphs.push(`[${label}][${cardOut}]overlay=x=(main_w-overlay_w)/2:y=${n(8)}:eof_action=pass:shortest=1:format=auto[${covered}]`)
      label = covered
      const place = (body: string, enable = '') => {
        text.push(`drawtext=${fontFile(true)}${body}${enable ? `:${enable}` : ''}`)
      }
      place(`text='KM/H':fontsize=${n(11)}:fontcolor=0x8d8d8d:x=(w-text_w)/2:y=${n(46)}`)
      for (const run of runs) {
        const enable = `enable='${between(run.t0, run.t1)}'`
        place(`text='${run.sample.gear}':fontsize=${n(22)}:fontcolor=0x1b1b1b:x=(w-${n(172)})/2+${n(30)}-text_w/2:y=${n(18)}`, enable)
        place(`text='${run.sample.speedKmh}':fontsize=${n(26)}:fontcolor=0x1b1b1b:x=(w-text_w)/2:y=${n(16)}`, enable)
      }
    }
    const drawn = text.length ? text.join(',') : 'null'
    const next = `base${index}`
    graphs.push(`[${label}]${drawn}[${next}]`)
    label = next
    if (!dash[index]) return label

    const slot = dashSlot - 1
    const stamp = (src: string, out: string, cssW: number, cssH = cssW) => {
      graphs.push(`[${src}]scale=${n(cssW)}:${n(cssH)}:flags=lanczos,format=rgba[${out}]`)
      return out
    }
    const over = (src: string, out: string, x: string, y: number, enable = '') => {
      graphs.push(`[${label}][${src}]overlay=${enable ? `${enable}:` : ''}x='${x}':y=${y}:eof_action=pass:shortest=1:format=auto[${out}]`)
      label = out
    }
    const angle = angleExpr(samples[index])
    const wheelGray = `wg${index}`
    graphs.push(`[${wheel[slot]}]rotate=a='${angle}':ow=iw:oh=ih:c=none[${wheelGray}]`)
    const cardX = `(main_w-${n(172)})/2`
    const wheelX = `${cardX}+${n(172)}-${n(30)}-overlay_w/2`
    const dotX = `${cardX}+${n(30)}-overlay_w/2`
    over(stamp(wheelGray, `wgf${index}`, 22), `vwg${index}`, wheelX, n(18))
    const auto = enableOf(runs, run => run.sample.autopilot)
    if (auto) {
      const wheelBlue = `wb${index}`
      graphs.push(`[${wheelAp[slot]}]rotate=a='${angle}':ow=iw:oh=ih:c=none[${wheelBlue}]`)
      over(stamp(wheelBlue, `wbf${index}`, 22), `vwb${index}`, wheelX, n(18), `enable='${auto}'`)
    }
    over(stamp(brakeOff[slot], `bof${index}`, 16), `vbof${index}`, dotX, n(44))
    const braking = enableOf(runs, run => run.sample.brake)
    if (braking) {
      over(stamp(brakeOn[slot], `bon${index}`, 16), `vbon${index}`, dotX, n(44), `enable='${braking}'`)
    }
    const accelFit = new Map<number, string>()
    for (const run of runs) {
      const step = accelStep(run.sample)
      if (accelFit.has(step)) continue
      accelFit.set(step, stamp(accel[step][slot], `acf${index}s${step}`, 16))
    }
    for (const [step, src] of accelFit) {
      const spans = enableOf(runs, run => accelStep(run.sample) === step)
      over(src, `vac${index}s${step}`, wheelX, n(44), `enable='${spans}'`)
    }
    const leftX = `${cardX}-${n(32)}`
    const rightX = `${cardX}+${n(172)}+${n(10)}`
    over(stamp(blinkL[slot], `blf${index}`, 22, 18), `vbl${index}`, leftX, n(30))
    over(stamp(blinkR[slot], `brf${index}`, 22, 18), `vbr${index}`, rightX, n(30))
    const leftOn = enableOf(runs, run => run.sample.blinkerLeft)
    const rightOn = enableOf(runs, run => run.sample.blinkerRight)
    const flash = `lt(mod(t\\,1)\\,0.4)`
    if (leftOn) over(stamp(blinkLOn[slot], `blof${index}`, 22, 18), `vblo${index}`, leftX, n(30), `enable='${flash}*(${leftOn})'`)
    if (rightOn) over(stamp(blinkROn[slot], `brof${index}`, 22, 18), `vbro${index}`, rightX, n(30), `enable='${flash}*(${rightOn})'`)
    return label
  })
  graphs.push(`${labels.map(label => `[${label}]`).join('')}concat=n=${files.length}:v=1:a=0[v]`)
  args.push('-filter_complex', graphs.join(';'), '-map', '[v]', '-progress', '-', '-nostats', output)
  return args
}

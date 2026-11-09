export enum TypeEnum {
  '所有',
  '事件',
  '哨兵',
  '行车记录仪',
  '保存'
}

export enum CameraEnum {
  '前',
  '后',
  '左',
  '右',
  '左柱',
  '右柱'
}

export enum ExportStatusEnum {
  进行中,
  导出成功,
  导出失败
}

export interface ExportTaskType {
  path: string
  name: string
  exportDir: string
  status: number
  duration: number
  progress: number
  log: string[]
}

export interface FileData {
  get(): Promise<{ url: string; name: string }>
  name: string
  path: string
}

export interface OriginVideo {
  id: string
  title: string
  time: number
  type: TypeEnum
  dir: string
  src_f: FileData
  src_b: FileData
  src_r: FileData
  src_l: FileData
  src_lp?: FileData
  src_rp?: FileData
  event?: number
}

export interface OriginFSVideo {
  title: string
  time: number
  type: TypeEnum
  src_f: string
  src_b: string
  src_r: string
  src_l: string
  src_lp?: string
  src_rp?: string
}

export interface Video {
  id: string
  title: string
  time: number
  type: TypeEnum
  dir: string
  src_f: string
  src_f_name: string
  src_b: string
  src_b_name: string
  src_r: string
  src_r_name: string
  src_l: string
  src_l_name: string
  src_lp?: string
  src_lp_name?: string
  src_rp?: string
  src_rp_name?: string
  src_f_path: string
  src_b_path: string
  src_r_path: string
  src_l_path: string
  src_lp_path?: string
  src_rp_path?: string
}

export interface ModelState {
  type: TypeEnum
  current?: Video
  list: OriginVideo[]
  events: VideoFile[]
}

export interface VideoFile {
  fs: FileSystemFileHandle
  path: string
  dir: string
}

export interface EventJson {
  timestamp: string
  city: string
  est_lat: string
  est_lon: string
  reason: string
  camera: string
}

export interface TauriFile {
  name: string
  path: string
  children?: TauriFile[]
}

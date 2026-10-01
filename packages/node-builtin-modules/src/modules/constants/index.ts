import { constants as fsConstants } from '@ass/node-builtin-modules/fs'

export const COPYFILE_EXCL = fsConstants.COPYFILE_EXCL
export const COPYFILE_FICLONE = 2
export const COPYFILE_FICLONE_FORCE = 4
export const F_OK = fsConstants.F_OK
export const R_OK = fsConstants.R_OK
export const W_OK = fsConstants.W_OK
export const X_OK = fsConstants.X_OK
export const UV_FS_COPYFILE_EXCL = COPYFILE_EXCL
export const UV_FS_COPYFILE_FICLONE = COPYFILE_FICLONE
export const UV_FS_COPYFILE_FICLONE_FORCE = COPYFILE_FICLONE_FORCE

export default { COPYFILE_EXCL, COPYFILE_FICLONE, COPYFILE_FICLONE_FORCE, F_OK, R_OK, UV_FS_COPYFILE_EXCL, UV_FS_COPYFILE_FICLONE, UV_FS_COPYFILE_FICLONE_FORCE, W_OK, X_OK }

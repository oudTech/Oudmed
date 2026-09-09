import { api } from './api'
import type { HospitalSettingsDTO, UpdateHospitalSettingsDTO } from '@oudhealth/contracts'

export const settingsApi = {
  get: () => api.get<HospitalSettingsDTO>('/settings').then((r) => r.data),
  update: (data: UpdateHospitalSettingsDTO) =>
    api.patch<HospitalSettingsDTO>('/settings', data).then((r) => r.data),
  setLogo: (file: File) => {
    const fd = new FormData()
    fd.append('file', file)
    return api.post<HospitalSettingsDTO>('/settings/logo', fd).then((r) => r.data)
  },
  removeLogo: () => api.delete<HospitalSettingsDTO>('/settings/logo').then((r) => r.data),
}

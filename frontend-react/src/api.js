import axios from 'axios'

const API = '/api'

export const getToken = () => localStorage.getItem('hila_token') || ''
export const setToken = (t) => localStorage.setItem('hila_token', t)
export const clearToken = () => {
  localStorage.removeItem('hila_token')
  window.location.reload()
}

export const api = () => {
  const token = getToken()
  return axios.create({
    baseURL: API,
    headers: {
      'Content-Type': 'application/json',
      Authorization: token ? `Bearer ${token}` : ''
    }
  })
}

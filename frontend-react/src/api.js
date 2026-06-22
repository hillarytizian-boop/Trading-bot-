import axios from "axios"

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000"

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { "Content-Type": "application/json" }
})

// REAL BALANCE FETCH
export const getBalance = async (token) => {
  return await api.get("/balance", {
    headers: { Authorization: `Bearer ${token}` }
  })
}

// PLACE TRADE
export const placeTrade = async (data, token) => {
  return await api.post("/trade", data, {
    headers: { Authorization: `Bearer ${token}` }
  })
}

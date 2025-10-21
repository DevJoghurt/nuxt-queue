import { defineEventHandler, setResponseHeader, useMetrics } from '#imports'

export default defineEventHandler((event) => {
  const { getPrometheusMetricsText } = useMetrics()
  const body = getPrometheusMetricsText()
  setResponseHeader(event, 'Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  return body
})

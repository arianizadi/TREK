// Trip Countdown — reference widget plugin.
//
// Demonstrates the full author path: definePlugin, a permission-gated route that
// reads trip data through ctx, and a response the client iframe renders. Runs
// isolated; ctx is the only way to reach TREK.
const { definePlugin } = require('trek-plugin-sdk')

/** Days (integer, >= 0) between now and an ISO date, or null if past/absent. */
function daysUntil(iso) {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null
  const diff = Math.ceil((then - Date.now()) / 86_400_000)
  return diff >= 0 ? diff : null
}

module.exports = definePlugin({
  routes: [
    {
      method: 'GET',
      path: '/next',
      auth: true,
      async handler(req, ctx) {
        // The client passes the dashboard's current trip id; the host enforces that
        // req.user actually has access to it, so a plugin can't read foreign trips.
        const tripId = Number(req.query.tripId)
        if (!tripId) return { status: 200, headers: json(), body: JSON.stringify({ trip: null }) }

        const t = await ctx.trips.getById(tripId, req.user.id)
        const days = daysUntil(t && (t.start_date || t.startDate))
        return {
          status: 200,
          headers: json(),
          body: JSON.stringify({ trip: t ? { name: t.title, days } : null }),
        }
      },
    },
  ],
})

function json() {
  return { 'content-type': 'application/json' }
}

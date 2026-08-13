// Why did nothing invoke send-request-emails?
//
// Paste this into the browser console ON https://roktolagbe-bd.github.io
// (any page). It reads the same VITE_ values the site was built with, so it
// tests exactly what the app does — not what we think the app does.
//
// It sends request_id "diagnostic", which the function rejects with a 400
// before touching anything. Nothing is created, matched or emailed.

;(async () => {
  const url = prompt('VITE_SUPABASE_URL (from your .env / GitHub secret)')
  const key = prompt('VITE_SUPABASE_ANON_KEY')
  if (!url || !key) return console.error('Need both to test.')

  const base = url.replace(/\/+$/, '')
  if (base !== url) {
    console.warn('Your URL has a trailing slash. The old build sent a double slash, which does not route.')
  }

  const target = base + '/functions/v1/send-request-emails'
  console.log('POST', target)

  try {
    const res = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + key,
        apikey: key,
      },
      body: JSON.stringify({ request_id: 'diagnostic' }),
    })
    const text = await res.text()
    console.log('HTTP', res.status)
    console.log(text)

    if (res.status === 400) {
      console.log('%cREACHED IT. The function is deployed, CORS is fine, the key is accepted.',
        'color:green;font-weight:bold')
      console.log('So the app failing to invoke it is something in the app, not the platform.')
    } else if (res.status === 401 || res.status === 403) {
      console.log('%cREJECTED AT THE GATE. verify_jwt or the key format.',
        'color:orange;font-weight:bold')
      console.log('This still counts as an invocation in the dashboard.')
    } else {
      console.log('%cReached it, but got an unexpected status. The body above is the reason.',
        'color:orange;font-weight:bold')
    }
  } catch (err) {
    console.log('%cNEVER REACHED SUPABASE.', 'color:red;font-weight:bold')
    console.log('This is the case that leaves TOTAL INVOCATIONS at zero.')
    console.log('CORS, DNS, a bad URL, or the function not being deployed.', err)
  }
})()

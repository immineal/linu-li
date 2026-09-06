# Reporting a security problem

Mail me at immineal@immineal.com. I read it, and I would rather hear about a
problem than read about it later.

Please do not open a public issue for anything that could be used against
someone before it is fixed.

## What is worth reporting

The tools process files in the browser and nothing is uploaded, so the usual
server-side categories mostly do not apply here. What does:

Anything that gets a file or an input off a visitor's machine. That is the one
promise this site makes, and a bug that breaks it is the worst kind here.

Anything that stores what someone typed. Tools remember dropdown settings and
nothing else. In September 2026 they stored every text field on every page,
including a WiFi password in the QR creator and a signing secret in the JWT
debugger, for as long as the browser kept them. That is fixed and guarded by
`tests/test-autosave-nur-einstellungen.js`, but the same mistake is easy to
make again.

Cross-site scripting through a file or a pasted input. Several tools render
what you give them, and a few use libraries that parse untrusted data.

A request to a server that the privacy policy does not name. The policy lists
every one, and `tests/test-autosave-nur-einstellungen.js` fails if a page
contacts a host that is missing from it.

## What to expect

An answer within a few days. I do not run a bounty programme and cannot pay
anything, so this is a request for goodwill rather than a deal. Tell me if you
want to be credited.

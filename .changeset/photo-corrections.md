---
"@some-useful-agents/core": minor
"@some-useful-agents/cli": minor
"@some-useful-agents/mcp-server": minor
"@some-useful-agents/temporal-provider": minor
"@some-useful-agents/dashboard": minor
---

Correct the photo or logo of who a notebook is about, in its conversation.

The picture a notebook shows of someone is now a part sua's correction agent can see. Say "use the portrait on my About page", with a link to the picture or to a page it's on, and Apply does three things. It fetches that picture with the usual guards; for a page, it finds their picture on it, the way research does. It keeps the picture as the one you picked, so a later Look again or Update doesn't replace it. And a picture's link that had been kept as a fact about them comes out with it. Saying "that isn't them" with no link takes the picture out, the same as Not them.

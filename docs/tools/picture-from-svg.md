# picture-from-svg

Turn an **SVG drawing** (one a model wrote) into a PNG picture kept with the run. It's how [Artboard illustrator](../../agents/examples/artboard-illustrator.yaml) makes its artboards: the model draws, this makes the picture. The picture shows in a conversation and on the run's page, and can be added to an answer ([notebooks](../notebooks.md#pictures-an-agent-made)).

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `svg` | string | yes | The drawing: one `<svg>…</svg>` with a `width` and `height` or a `viewBox`. A reply holding one is fine; the text around it is ignored. |
| `title` | string | no | What it is, for the picture's caption |
| `timeout` | number | no | Timeout in seconds (default 60) |

## Outputs

| Name | Type | Description |
|---|---|---|
| `title` | string | What it is |
| `graphic_path` | string | Where the picture is on disk, with the run |
| `file` | string | The picture's name with the run (`<node>-<n>.png`) |
| `width`, `height` | number | The size it was drawn at, px (the PNG is twice that, so it stays sharp) |
| `error` | string | Plain-English failure reason, or null on success |

`result` is the same as JSON (`{"title", "graphic_path", "file", "width", "height"}`), so a node that ends with it gives an output widget a `graphic_path` to show.

## What's taken out first

The drawing comes from a model, so before it's drawn: `<script>`, `<foreignObject>` and other embedded content go, as do event handlers (`onclick=` …), `javascript:` and any link or CSS `url()` that would fetch something. Only links within the drawing (`#id`) and inline PNG, JPEG, GIF or WebP pictures stay. A drawing over 400,000 characters, or with no size, is refused with the reason. It's drawn in the same headless browser as [web-screenshot](web-screenshot.md), at its own size up to 2000px wide.

## Where it's kept

As a PNG in `<data dir>/run-files/<run id>/`, like a screenshot: the run page lists it, `/runs/<id>/files/<name>` serves it (signed in). A call outside a run has nowhere to keep it and says so.

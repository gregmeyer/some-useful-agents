# template

Literal text with `{{inputs.X}}` / `{{upstream.X.result}}` / `{{vars.X}}` interpolation. No side effects.

Useful when you want to prepare a string that another node will consume — separating "build the payload" from "send the payload" makes each step re-runnable.

## Inputs

| Name | Type | Required | Description |
|---|---|---|---|
| `text` | string | yes | Template text with placeholders |

## Outputs

| Name | Type | Description |
|---|---|---|
| `result` | string | Interpolated text |

## Example

```yaml
- id: format
  tool: template
  dependsOn: [fetch]
  toolInputs:
    text: |
      {
        "topic": "{{inputs.TOPIC}}",
        "body": "{{upstream.fetch.result}}",
        "generated_at": "{{vars.NOW}}"
      }

- id: post
  tool: http-post
  dependsOn: [format]
  toolInputs:
    url: "{{vars.API_URL}}"
    body: "{{upstream.format.result}}"
```

## Notes

- Placeholders resolve at save-validation time — typos in `inputs` or upstream `result` fail schema validation.
- No conditional or loop logic — this is string substitution only.
- For structured templating, use a claude-code node with a prompt.

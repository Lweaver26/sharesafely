# ShareSafely – Front End

A static HTML/CSS/JS front end with no build step and no dependencies.

| File         | Purpose                                          |
|--------------|--------------------------------------------------|
| `index.html` | Page markup                                      |
| `styles.css` | Styling (follows the OS light/dark setting)      |
| `app.js`     | UI logic. **All settings are in `CONFIG` at the top.** |

## Hooking up your back end

1. In `app.js`, set `mockMode: false`. While it's `true`, a yellow **DEMO MODE** badge shows and uploads are simulated.
2. Set `uploadUrl` to your endpoint. The default is `/api/upload`.
3. Serve these files from your web app: `wwwroot/` for ASP.NET Core, or `express.static('public')` for Node.

### Request the page sends

```
POST {uploadUrl}
Content-Type: multipart/form-data

file           = <the file>
expiryMinutes  = 15 | 60 | 1440 | 10080
```

You can change the field names with `fileField` and `expiryField` in `CONFIG`.

### Response the page expects

Success (any 2xx status):

```json
{ "url": "https://<account>.blob.core.windows.net/<container>/<blob>?<sas>", "expiresOn": "2026-10-08T15:00:00Z" }
```

- The page also accepts `sasUrl` or `link` in place of `url`, and `expiresAt` in place of `expiresOn`.
- `expiresOn` is optional. If it's missing, the page works out the expiry from the selected duration.

Error (any non-2xx status):

```json
{ "error": "Message shown to the user" }
```

## Other settings in `CONFIG`

- `maxFileSizeMB`: checked in the browser before upload. Set it to `0` for no limit. Enforce the limit on the server too.
- `expiryOptions`: the choices in the expiry dropdown.

## Notes

- If the page and the API are on different origins, enable CORS on the API.
- The **Copy** button works best over HTTPS, which Azure Web Apps provides by default.

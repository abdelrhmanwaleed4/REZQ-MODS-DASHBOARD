# REZK images updated (original files, no alterations)

The provided four files are copied **byte-for-byte** into `client/public/branding/`. No cropping, retouching, resizing or regeneration has been performed on the actual image files.

| Supplied original | Website path | Usage |
|---|---|---|
| `1000126853.png` | `/branding/rezk-logo.png` | Header brand mark |
| `1000126852.png` | `/branding/rezk-login-banner.png` | Desktop sign-in page illustration |
| `1000126782.jpg` | `/branding/rezk-team-poster.jpg` | Mobile sign-in + approval page poster |
| `1000126773.jpg` | `/branding/rezk-dashboard-banner.jpg` | Main dashboard banner |

Note: The source ZIP had no prior bitmap website artwork. The existing graphic brand elements were mostly drawn with CSS, so these four images are now linked into those relevant website locations. The edited ZIP uses the upgraded staff-operations codebase as its starting point, preserving the management features.

Run `pnpm install`, `pnpm check`, `pnpm build` in the project root in a compatible environment. Google OAuth, database, and Discord require secrets/server setup, and updating files does not change an already deployed Manus website until this project is uploaded and deployed.

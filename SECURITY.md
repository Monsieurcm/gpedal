# 🔒 Security Guidelines for GPedal (Fork Configuration)

## API Keys Management

### ✅ Fork Status
This is a **forked version** of GPedal configured with a dedicated Google Maps API key: **`AIzaSyBUEC4iOMrgHjI0P0Lgq337LPgvmhQFzJE`**

### Configuration for This Fork

1. **Environment File Setup**
   - `.env.example` contains the default key for this fork
   - `.env.local` is your local configuration (never committed)
   - To use this fork, simply run: `npm run build:secure`

2. **Building with the Fork's API Key**
   ```bash
   # Install dependencies
   npm install

   # Build with the configured key
   npm run build:secure

   # Start development server
   npm start
   ```

3. **Using Your Own API Key**
   If you want to use a different key:
   - Edit `.env.local` and replace the key
   - Run `npm run build:secure` again

### Security Best Practices

✅ **DO:**
- Use environment variables for all sensitive data
- Store `.env.local` locally only (it's in .gitignore)
- Rotate keys periodically if compromise is suspected
- Use minimal API scopes
- Monitor API usage for unusual activity
- Restrict keys to specific domains and APIs only

❌ **DON'T:**
- Commit `.env.local` to version control
- Share API keys in chat, email, or issues
- Use the same key across multiple projects
- Hardcode secrets in source code
- Keep exposed keys active

### File Structure

```
.env.example          # Template with default fork key
.env.local           # Local config (gitignored)
.gitignore           # Excludes sensitive files
build-with-env.js    # Script to inject env vars into build
SECURITY.md          # This file
```

## Troubleshooting

**Build fails with "GOOGLE_MAPS_API_KEY not found"**
- Ensure `.env.local` exists
- Run: `cp .env.example .env.local`
- Add your key to `.env.local`

**API calls fail after build**
- Verify the key in `.env.local`
- Check Google Cloud Console for API restrictions
- Ensure Maps API is enabled in your project

**Google Maps error: `RefererNotAllowedMapError`**
- In Google Cloud Console, open your API key restrictions
- Set `Application restrictions` to `HTTP referrers (web sites)`
- Add authorized referrers for GitHub Pages:
   - `https://monsieurcm.github.io/*`
   - `https://monsieurcm.github.io/gpedal/*`
- For local development, also allow:
   - `https://localhost/*`
   - `http://localhost/*`
   - `https://127.0.0.1/*`
   - `http://127.0.0.1/*`
- Ensure `API restrictions` includes `Maps JavaScript API` (and any additional Maps APIs you actually use)

## References

- [Google Cloud Security Best Practices](https://cloud.google.com/docs/authentication/best-practices-applications)
- [NPM dotenv package](https://www.npmjs.com/package/dotenv)
- [Managing secrets with GitHub](https://docs.github.com/en/actions/security-guides/encrypted-secrets)

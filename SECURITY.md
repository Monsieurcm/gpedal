# 🔒 Security Guidelines for GPedal

## API Keys Management

### Current Security Issue
⚠️ **URGENT**: The Google Maps API key is currently exposed in the public repository (`dist/index.html`).

### Immediate Actions Required

1. **Regenerate the API Key**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Delete the exposed key: `AIzaSyD8CBYhq7f2aibteBvLz2jvRZAHu346qJM`
   - Create a new key

2. **Restrict the New Key**
   - **API Restrictions**: Limit to "Maps JavaScript API" only
   - **HTTP referrers**: Add authorized domains:
     - `https://chadj.github.io`
     - `https://chadj.github.io/gpedal/*`
     - `http://localhost:*` (for local development)

3. **Store Securely**
   - Copy `.env.example` to `.env.local`
   - Add your new key to `.env.local`
   - **Never commit `.env.local`** (it's in .gitignore)

### Local Development Setup

```bash
# 1. Copy the example file
cp .env.example .env.local

# 2. Edit .env.local with your actual keys
nano .env.local

# 3. Run the build script (coming soon)
npm run build:secure
```

### Handling Exposed Secrets in Git History

If needed to clean the git history:

```bash
# Using git-filter-repo (recommended)
pip install git-filter-repo
git-filter-repo --invert-paths --paths dist/index.html
```

## Best Practices

✅ **DO:**
- Use environment variables for all sensitive data
- Store `.env.local` locally only
- Rotate keys periodically
- Use minimal API scopes
- Monitor API usage for unusual activity

❌ **DON'T:**
- Commit `.env` files to version control
- Share API keys in chat, email, or issues
- Use the same key across multiple projects
- Hardcode secrets in source code
- Keep exposed keys active

## GitHub Pages Deployment

When deploying to GitHub Pages, you have two options:

### Option 1: Use Secrets in GitHub Actions (Recommended)
- Store the API key in GitHub Secrets
- Use Actions to build and deploy with the secret injected

### Option 2: Use a Restricted Domain-Only Key
- Create a key with strict HTTP referrer restrictions
- Include it in committed files (dist/)
- Monitor usage closely

## References

- [Google Cloud Security Best Practices](https://cloud.google.com/docs/authentication/best-practices-applications)
- [NPM dotenv package](https://www.npmjs.com/package/dotenv)
- [Managing secrets with GitHub](https://docs.github.com/en/actions/security-guides/encrypted-secrets)

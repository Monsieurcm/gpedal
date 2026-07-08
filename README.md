# GPedal

Virtually ride indoors with Google Street View and bluetooth bike power meters (Web Bluetooth API)

Try it out [https://chadj.github.io/gpedal/](https://chadj.github.io/gpedal/)

![Image of screenshot](https://chadj.github.io/gpedal/images/screenshot.jpg)

## 🍴 Fork Configuration

This fork is configured with its own Google Maps API key for local development and testing.

### Quick Start

```bash
# Clone this fork
git clone https://github.com/Monsieurcm/gpedal.git
cd gpedal

# Install dependencies
npm install

# Build with the configured API key
npm run build:secure

# Start development server
npm start
```

### Using Your Own API Key

If you want to use a different API key:

1. Copy the environment template:
   ```bash
   cp .env.example .env.local
   ```

2. Edit `.env.local` and replace the API key:
   ```
   GOOGLE_MAPS_API_KEY=YOUR_KEY_HERE
   ```

3. Build and run:
   ```bash
   npm run build:secure
   npm start
   ```

See [SECURITY.md](SECURITY.md) for more details about API key management.

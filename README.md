# Mushroom Tracker App

This is a React-based application for tracking mushroom grows.

## Features

- Add, view, and edit grow logs
- Upload photos and set reminders
- Import/Export backups
- Visualize data in Analytics and Calendar views
- Settings management
- Dark mode
- Tab-based UI

## Usage

1. Clone the repo:
```bash
git clone https://github.com/ChaoticNeutralMyco/mushroom-tracker-app.git
```

2. Install dependencies:
```bash
npm install
```

3. Run the development server:
```bash
npm run dev
```

4. Build for production:
```bash
npm run build
```

## Deployment

We recommend using [Vercel](https://vercel.com/) for quick deployment. Make sure `vite` is in your `dependencies`.

## Firebase

Firebase has been removed for production stability. You may reintroduce it later with:
- `firebase.js`
- State syncing via Firestore
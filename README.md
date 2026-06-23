# ChessMania ⚔️

Welcome to **ChessMania**, the ultimate real-time online chess lounge! Challenge your online friends to a fast-paced game of chess, chat in real-time, customize your board themes, and track your global rating!

👉 **[Play Live Now on Firebase Hosting 🚀](https://chessmania-india.web.app/)**

---

## ⚡ Key Features

*   **Google Identity Authentication**: Secure, one-click login and session management powered by Firebase Auth.
*   **Gmail-derived Clean Usernames**: Automatically generates unique, clean usernames using the player's Gmail name without spaces or special symbols (alphanumeric only).
*   **Real-time Chess Challenges**: Send live 'Rollmate' chess invitations to any of your online friends and join the game instantly once accepted.
*   **Real-time Social & Direct Chat**: Add friends, track their online presence status, and chat in real-time.
*   **Stunning Board & Piece Customization**: Fully customize your board and pieces with various premium visual themes (such as Neon Glow, 8-Bit Retro, Neo Modern, Wood, and Glassic).
*   **Secure Ticket Reporting**: Submit support queries securely from Settings. The client logs the query in Firestore, which automatically dispatches email confirmations to both the user and the administrator.
*   **Rich Cinematic Aesthetics**: Dynamic backgrounds that transition from a cinematic chess battlefield to a neon-glowing king backdrop when viewing the player profile.

---

## 🛠️ Tech Stack

*   **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Lucide React (Icons)
*   **Backend & DB**: Cloud Firestore (Real-time listeners & collections), Firebase Realtime Database (Presence status & challenges), Firebase Auth (Google Identity provider)
*   **CI/CD**: GitHub Actions (Automatic build and deploy to Firebase Hosting on main branch merges or pull requests)

---

## 🚀 Local Development Setup

To run this project locally, follow these steps:

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn

### Steps

1.  **Clone the repository**:
    ```bash
    git clone https://github.com/K-692/ChessMania.git
    cd ChessMania
    ```

2.  **Install dependencies**:
    ```bash
    npm install
    ```

3.  **Setup environment variables**:
    Create a `.env` file in the root directory and copy the contents from `.env.example`, substituting your own Firebase configuration credentials:
    ```bash
    cp .env.example .env
    ```

4.  **Start the development server**:
    ```bash
    npm run dev
    ```
    Open your browser and navigate to the address shown in the terminal (usually `http://localhost:5173`).

---

## ☁️ Deployment

This project is configured to run fully on **Firebase Serverless Architecture**.

Continuous integration and deployment are configured via GitHub workflows:
- **PR Previews**: Pull requests automatically build the React app and deploy a temporary preview site.
- **Production merges**: Commits to the `main` branch trigger a production build and immediately upload updates to **[chessmania-india.web.app](https://chessmania-india.web.app/)**.

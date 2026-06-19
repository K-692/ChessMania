# Check & Mate: High-Stakes Chess Lounge ⚔️

Welcome to **Check & Mate**, a premium, real-time online chess lounge where your brain meets the bank! Stake your chess-coins, outsmart rivals in real-time matches, and seize the entire prize pool. Watch your wallet grow continuously, get backup recovery top-ups, and dominate the global rankings!

👉 **[Play Live Now on Firebase Hosting 🚀](https://check-mate-6e0a7.web.app/)**

---

## ⚡ Key Features

*   **Google Identity Authentication**: Secure, one-click login and session management powered by Firebase Auth.
*   **Real-time Chess Engine**: High-fidelity board rendering and strict legal-move enforcement powered by `chess.js` and `react-chessboard`.
*   **Dynamic Elo Matchmaking**: Queue and find matches automatically based on rating bands (±100 Elo) and stake levels. The search band automatically expands every 10 seconds to keep queues fast!
*   **Staking & Wallet Integrity**: All games require staking entry coins. The winner takes the entire pool! Every transaction is written through atomic Firestore transactions with immutable ledger auditing.
*   **Hourly Coin Credits**: Earn **100 coins automatically for every hour active**, credited to your wallet up to a maximum limit of 1000 coins.
*   **Geographical Coin Packs**: Add funds using regional currency pricing (USD, EUR, GBP, INR) converted dynamically from base INR prices using monthly frozen exchange rates. A daily spend limit of 40,000 INR protects players.
*   **Country Representation**: Represent your country in matches and profiles. Select a country to display your national flag emoji (limited to one update per calendar month).
*   **Secure Ticket Reporting**: Submit support queries securely from Settings. The client logs the query in Firestore, which automatically dispatches email confirmations to both the user and the developer via Firebase Trigger Email integration.
*   **Premium Glassmorphic Design**: A stunning visual interface featuring dark mode, neon glowing accents, smooth slide-out views, and sound effects.

---

## 🛠️ Tech Stack

*   **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Lucide React (Icons)
*   **Backend & DB**: Cloud Firestore (Real-time listeners & atomic transactions), Firebase Auth (Google Identity provider)
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
    git clone https://github.com/K-692/Check-Mate.git
    cd Check-Mate
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

This project is configured to run fully on **Firebase Serverless Architecture (Free Tier)**. 

Continuous integration and deployment are fully configured in the `.github/workflows` folder:
- **PR Previews**: Pull requests automatically build the React app and deploy a temporary preview site.
- **Production merges**: Commits to the `main` branch trigger a production build and immediately upload updates to **[check-mate-6e0a7.web.app](https://check-mate-6e0a7.web.app/)**.

# personalFinance - Double-Entry Inspired Cash Flow Tracker

A lightweight, single-page web application designed to manage personal finances using a double-entry accounting mental model. Users can track real-time income, log structural expenses against asset/liability accounts, execute internal transfers, and visualize monthly expenditure trends.

### 🚀 Key Features
*   **Dual-Account Classification:** Supports dynamic creation of **Asset** accounts and **Liability/Expense** categories to properly map where money comes from and where it goes.
*   **Multi-Type Transaction Management:** 
    *   *Income:* Logs positive cash flow directly into asset accounts.
    *   *Expense:* Simultaneously deducts from an asset account while categorizing the purpose under an expense/liability log.
    *   *Transfer:* Handles internal funds movement between asset accounts with strict source/destination validation.
*   **Historical Monthly Archiving:** Automatically groups and filters transaction history, financial reports, and net worth calculations by the selected month.
*   **Interactive Data Visualization:** Integrates **Chart.js** to render dynamic Doughnut charts detailing expenditure allocation based on liability group distributions.
*   **Local Data Persistence:** Utilizes browser `localStorage` to securely save transaction ledgers and custom account settings without needing a backend database.

### 🛠️ Tech Stack
*   **Frontend:** HTML, JavaScript, CSS.
*   **Data Visualization:** Chart.js (via CDN).
*   **Storage:** Web Storage API (`localStorage`).

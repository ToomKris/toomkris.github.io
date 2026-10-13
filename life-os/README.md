# 🌙 Life OS

A free replacement for a Notion life dashboard: training, money, trips, loans and calendar in one place.

- **Database:** a Google Sheet you own (`Events`, `Transactions`, `Budgets`, `Loans`, `Templates`, `Rules`, `Settings` tabs).
- **Automations & API:** Google Apps Script bound to that sheet ([`apps-script/Code.gs`](apps-script/Code.gs)).
- **App:** this folder, a static site served by GitHub Pages at `https://toomkris.github.io/life-os/`.

No servers, no subscriptions. The app runs on demo data until you connect it.

## One-time setup (about 5 minutes)

1. Open the **🌙 Life OS** sheet in Google Drive.
2. **Extensions → Apps Script.** Delete what's there, paste the contents of [`apps-script/Code.gs`](apps-script/Code.gs), and save.
3. Pick `setup` in the function dropdown and press **Run**. Google asks for permission (Sheets, Calendar, Drive, Gmail). Because it's your own script, it shows "Google hasn't verified this app": choose **Advanced → Go to Life OS**.
   `setup` creates the tabs, imports your Notion data (from `Life OS seed.json` in your Drive, which it then moves to the bin), creates a **Life OS** calendar and a **Life OS · Revolut imports** Drive folder, and turns on the schedules below.
4. **Deploy → New deployment → Web app.** Execute as **Me**, access **Anyone**. Copy the web app URL (it ends in `/exec`).
5. Back in the sheet, reload, then **🌙 Life OS → Connect the app**. Paste the URL and press **Open & connect my app**: the app opens already connected.
6. On your phone, open the app in the browser and use **Add to Home Screen**.

When `Code.gs` changes later, paste the new version and use **Deploy → Manage deployments → Edit → New version** so the URL stays the same.

## What runs by itself

| When | What |
|---|---|
| Every hour | Two-way calendar sync. Events from the app appear in the **Life OS** calendar (with colours per category). If you move one in Google Calendar, the app follows. Anything in your main calendar with a tag like `#gym`, `#dance`, `#trip`, `#birthday`, `#event` or `#social` in the title is pulled into the app. |
| Every 6 hours | Revolut CSVs dropped into the **Life OS · Revolut imports** folder are imported, duplicates skipped, then moved to `Imported`. You can also drop a CSV straight into the Money page. |
| On every import or edit | Merchants are sorted using the `Rules` tab (e.g. `rimi → Groceries`). Spending during a trip's dates is linked to that trip. Payments that mention a loan's lender are linked to the loan. Picking a category with "remember" adds a new rule. |
| Sundays 17:00 | The next two weeks of training are added from your weekly template. |
| Daily 08:00 | Email reminders: loan payments due in the next 3 days, birthdays (a week and a day before, with the gift idea), trips and events starting soon, planned payments. |
| Sundays 19:00 | Weekly summary email: sessions done, spending vs. budget, the week ahead. |

## Privacy

The app's code is public in this repo, but your data never is. It lives in your Google Sheet, and the app only reads it with the token you paste into Settings (stored in your browser only). Anyone without the token gets "Wrong token".

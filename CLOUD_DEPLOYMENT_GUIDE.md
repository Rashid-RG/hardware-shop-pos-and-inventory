# 24/7 Cloud Deployment Guide

Follow this guide to move your Hardware POS system to the cloud. Once deployed, the system will run **24 hours a day, 7 days a week**, and you can use it on your phone even when your laptop is completely turned off.

---

## 🛠️ Step 1: Create a Free Cloud Database (Supabase)

We need a database on the internet to store your sales, stock, and settings.

1. Go to [Supabase (https://supabase.com)](https://supabase.com) and sign up for a free account.
2. Click **New Project** and select the free tier.
3. Choose a project name (e.g., `hardware-pos-db`) and enter a strong database password.
4. Once the project is ready (takes about 1-2 minutes):
   - Go to **Project Settings** (gear icon on the left sidebar) -> **Database**.
   - Scroll down to **Connection String** -> Select **URI**.
   - Copy the string. It will look like this:
     ```text
     postgresql://postgres.[username]:[password]@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require
     ```
   - **Important:** Replace `[password]` inside the URL with your database password. Keep this URL safe!

---

## 🚀 Step 2: Deploy the App to Render (Free)

Render will host the POS system and serve it to your mobile phone.

1. Go to [Render (https://render.com)](https://render.com) and sign up for a free account.
2. Click **New** -> **Web Service**.
3. Connect your GitHub repository containing this POS project. (If you don't have it on GitHub, you can initialize a private Git repo, commit your code, and push it to GitHub first).
4. Configure the Web Service settings:
   - **Name:** Choose a name (e.g., `my-hardware-pos`). This will be part of your web link.
   - **Environment:** `Node`
   - **Region:** Choose the region closest to you.
   - **Branch:** `main` (or the branch you uploaded to GitHub).
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Instance Type:** `Free`

5. Scroll down and click **Advanced** -> **Add Environment Variable**. Add the following variables:
   - **`DATABASE_URL`**: *(Paste the connection URI you copied from Supabase in Step 1)*
   - **`NODE_ENV`**: `production`
   - **`JWT_SECRET`**: *(Type a long secret key, e.g., `my-pos-secret-secure-key-12345`)*
   - **`PORT`**: `3000`

6. Click **Deploy Web Service**. Render will now build and launch your application.

---

## 📱 Step 3: Access it on your Mobile Phone

1. Once the deployment finishes (takes about 3-5 minutes), Render will show your public web link at the top left of the dashboard. It will look like:
   ```text
   https://my-hardware-pos.onrender.com
   ```
2. Open this link on your phone (or your father's phone) from anywhere!
3. **Login:** Use the Super Admin email `admin@hardwarepos.local` and password `ChangeMe123!`.
4. **Save Shortcut:** 
   - On iOS (Safari): Tap **Share** -> **Add to Home Screen**.
   - On Android (Chrome): Tap **Menu** (three dots) -> **Add to Home Screen**.

---

> [!TIP]
> **Product Images Tip:** 
> When running in the free cloud, uploaded image files are cleared whenever the server restarts. To avoid this, when you add or edit a product, simply upload your product images to a free host like [Postimages (https://postimages.org/)](https://postimages.org/) or Imgur, and copy/paste the **Direct Image Link** into the image URL field in the register product form.

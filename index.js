require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

// =========================
// DATABASE CONNECTION
// =========================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// =========================
// HEALTH CHECK
// =========================
app.get("/", (req, res) => {
  res.json({ message: "Wallet API Running 🚀" });
});

// =========================
// LOGIN
// =========================
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1 AND password = $2",
      [email, password]
    );

    if (!result.rows.length) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    const user = result.rows[0];
    delete user.password;

    res.json({ user });

  } catch (err) {
    res.status(500).json({ error: "Login failed" });
  }
});

// =========================
// GET WALLET
// =========================
app.get("/wallets/:user_id", async (req, res) => {
  const { user_id } = req.params;

  try {
    const result = await pool.query(
      "SELECT * FROM wallets WHERE user_id = $1",
      [user_id]
    );

    if (!result.rows.length) {
      return res.json({
        wallets: { main: 0, savings: 0, business: 0 }
      });
    }

    res.json({ wallets: result.rows[0] });

  } catch (err) {
    res.status(500).json({ error: "Wallet error" });
  }
});

// =========================
// FUND / TRANSACTION
// =========================
app.post("/transaction", async (req, res) => {
  const { user_id, type, wallet, amount, category, note } = req.body;

  try {
    await pool.query(
      `INSERT INTO transactions (user_id, type, amount, category, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [user_id, type, amount, category, note]
    );

    const value = type === "income" ? amount : -amount;

    await pool.query(
      `UPDATE wallets SET ${wallet} = COALESCE(${wallet}, 0) + $1
       WHERE user_id = $2`,
      [value, user_id]
    );

    res.json({ message: "Transaction successful" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// INTERNAL TRANSFER (WITH PIN)
// =========================
app.post("/transfer", async (req, res) => {
  const { user_id, from, to, amount, pin } = req.body;

  try {
    const userResult = await pool.query(
      "SELECT * FROM users WHERE id = $1",
      [user_id]
    );

    if (!userResult.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = userResult.rows[0];

    if (!user.pin || user.pin !== pin) {
      return res.status(401).json({ error: "Invalid PIN" });
    }

    const walletResult = await pool.query(
      "SELECT * FROM wallets WHERE user_id = $1",
      [user_id]
    );

    if (!walletResult.rows.length) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    const wallet = walletResult.rows[0];

    const allowed = ["main", "savings", "business"];
    if (!allowed.includes(from) || !allowed.includes(to)) {
      return res.status(400).json({ error: "Invalid wallet type" });
    }

    if (wallet[from] < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    const newFrom = wallet[from] - amount;
    const newTo = wallet[to] + amount;

    await pool.query(
      `UPDATE wallets SET ${from} = $1 WHERE user_id = $2`,
      [newFrom, user_id]
    );

    await pool.query(
      `UPDATE wallets SET ${to} = $1 WHERE user_id = $2`,
      [newTo, user_id]
    );

    await pool.query(
      `INSERT INTO transactions (user_id, type, amount, category, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [user_id, "transfer", amount, "wallet-transfer", `${from} → ${to}`]
    );

    res.json({
      message: "Transfer successful",
      wallets: { ...wallet, [from]: newFrom, [to]: newTo }
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// P2P TRANSFER (USER → USER)
// =========================
app.post("/transfer-user", async (req, res) => {
  const { sender_id, receiver_id, amount, pin } = req.body;

  try {
    const senderRes = await pool.query(
      "SELECT * FROM users WHERE id = $1",
      [sender_id]
    );

    if (!senderRes.rows.length) {
      return res.status(404).json({ error: "Sender not found" });
    }

    const sender = senderRes.rows[0];

    if (!sender.pin || sender.pin !== pin) {
      return res.status(401).json({ error: "Invalid PIN" });
    }

    const senderWalletRes = await pool.query(
      "SELECT * FROM wallets WHERE user_id = $1",
      [sender_id]
    );

    const receiverWalletRes = await pool.query(
      "SELECT * FROM wallets WHERE user_id = $1",
      [receiver_id]
    );

    if (!senderWalletRes.rows.length || !receiverWalletRes.rows.length) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    const senderWallet = senderWalletRes.rows[0];
    const receiverWallet = receiverWalletRes.rows[0];

    if (senderWallet.main < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    const newSender = senderWallet.main - amount;
    const newReceiver = receiverWallet.main + amount;

    await pool.query(
      "UPDATE wallets SET main = $1 WHERE user_id = $2",
      [newSender, sender_id]
    );

    await pool.query(
      "UPDATE wallets SET main = $1 WHERE user_id = $2",
      [newReceiver, receiver_id]
    );

    await pool.query(
      `INSERT INTO transactions (user_id, type, amount, category, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [sender_id, "transfer", amount, "p2p-out", `Sent to ${receiver_id}`]
    );

    await pool.query(
      `INSERT INTO transactions (user_id, type, amount, category, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [receiver_id, "income", amount, "p2p-in", `Received from ${sender_id}`]
    );

    res.json({ message: "P2P transfer successful" });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// START SERVER
// =========================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});

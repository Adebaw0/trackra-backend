require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

// 🔌 NEON DATABASE CONNECTION
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 🟢 HOME
app.get("/", (req, res) => {
  res.json({ message: "Trackra API Running 🚀" });
});


// =========================
// 🔐 LOGIN
// =========================
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await pool.query(
      "SELECT * FROM users WHERE email = $1 AND password = $2",
      [email, password]
    );

    if (user.rows.length === 0) {
      return res.status(400).json({ error: "Invalid login" });
    }

    res.json({ user: user.rows[0] });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});


// =========================
// 💳 GET WALLET
// =========================
app.get("/wallets/:user_id", async (req, res) => {
  const { user_id } = req.params;

  try {
    const result = await pool.query(
      "SELECT * FROM wallets WHERE user_id = $1",
      [user_id]
    );

    if (result.rows.length === 0) {
      return res.json({
        wallets: { main: 0, savings: 0, business: 0 }
      });
    }

    res.json({ wallets: result.rows[0] });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Wallet error" });
  }
});


// =========================
// 📜 TRANSACTIONS
// =========================
app.get("/transactions/:user_id", async (req, res) => {
  const { user_id } = req.params;

  try {
    const result = await pool.query(
      "SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC",
      [user_id]
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Transaction error" });
  }
});


// =========================
// ➕ INCOME / EXPENSE
// =========================
app.post("/transaction", async (req, res) => {
  const { user_id, type, wallet, amount, category, note } = req.body;

  try {
    await pool.query(
      `INSERT INTO transactions (user_id, type, amount, category, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [user_id, type, amount, category, note]
    );

    // update wallet balance
    if (wallet) {
      await pool.query(
        `UPDATE wallets
         SET ${wallet} = ${wallet} + $1
         WHERE user_id = $2`,
        [type === "income" ? amount : -amount, user_id]
      );
    }

    res.json({ message: "Transaction added" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Transaction failed" });
  }
});


// =========================
// 🔁 INTERNAL WALLET TRANSFER
// =========================
app.post("/transfer", async (req, res) => {
  const { user_id, from, to, amount } = req.body;

  try {
    const user = await pool.query(
      "SELECT * FROM wallets WHERE user_id = $1",
      [user_id]
    );

    if (user.rows.length === 0) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    const wallet = user.rows[0];

    const allowed = ["main", "savings", "business"];
    if (!allowed.includes(from) || !allowed.includes(to)) {
      return res.status(400).json({ error: "Invalid wallet type" });
    }

    if (wallet[from] < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    const newFrom = wallet[from] - amount;
    const newTo = wallet[to] + amount;

    const updated = await pool.query(
      `UPDATE wallets
       SET ${from} = $1,
           ${to} = $2
       WHERE user_id = $3
       RETURNING *`,
      [newFrom, newTo, user_id]
    );

    await pool.query(
      `INSERT INTO transactions (user_id, type, amount, category, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [user_id, "transfer", amount, "wallet-transfer", `${from} → ${to}`]
    );

    res.json({
      message: "Transfer successful",
      wallets: updated.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Transfer failed" });
  }
});


// =========================
// 💸 P2P TRANSFER (USER → USER)
// =========================
app.post("/transfer-user", async (req, res) => {
  const { from_user_id, to_email, amount } = req.body;

  try {
    // sender
    const sender = await pool.query(
      "SELECT * FROM wallets WHERE user_id = $1",
      [from_user_id]
    );

    if (sender.rows.length === 0) {
      return res.status(404).json({ error: "Sender not found" });
    }

    // receiver user
    const receiverUser = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [to_email]
    );

    if (receiverUser.rows.length === 0) {
      return res.status(404).json({ error: "Receiver not found" });
    }

    const to_user_id = receiverUser.rows[0].id;

    // receiver wallet
    const receiver = await pool.query(
      "SELECT * FROM wallets WHERE user_id = $1",
      [to_user_id]
    );

    if (receiver.rows.length === 0) {
      return res.status(404).json({ error: "Receiver wallet missing" });
    }

    // balance check
    if (sender.rows[0].main < amount) {
      return res.status(400).json({ error: "Insufficient funds" });
    }

    // update sender
    const newSender = sender.rows[0].main - amount;

    await pool.query(
      "UPDATE wallets SET main = $1 WHERE user_id = $2",
      [newSender, from_user_id]
    );

    // update receiver
    const newReceiver = receiver.rows[0].main + amount;

    await pool.query(
      "UPDATE wallets SET main = $1 WHERE user_id = $2",
      [newReceiver, to_user_id]
    );

    // transaction logs
    await pool.query(
      `INSERT INTO transactions (user_id, type, amount, category, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [from_user_id, "transfer-out", amount, "p2p", `Sent to ${to_email}`]
    );

    await pool.query(
      `INSERT INTO transactions (user_id, type, amount, category, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [to_user_id, "transfer-in", amount, "p2p", `Received`]
    );

    res.json({ message: "P2P transfer successful" });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "P2P transfer failed" });
  }
});


// 🚀 START SERVER
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

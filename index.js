require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

// 🔌 DATABASE CONNECTION (NEON)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// 🟢 HEALTH CHECK
app.get("/", (req, res) => {
  res.json({ message: "Trackra API Running 🚀" });
});

// 🟢 LOGIN (simple version)
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await pool.query(
      "SELECT * FROM users WHERE email = $1 AND password = $2",
      [email, password]
    );

    if (user.rows.length === 0) {
      return res.status(400).json({ error: "Invalid credentials" });
    }

    res.json({ user: user.rows[0] });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

// 🟢 GET WALLET BALANCES
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
    res.status(500).json({ error: "Failed to fetch wallets" });
  }
});

// 🟢 GET TRANSACTIONS
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
    res.status(500).json({ error: "Failed to fetch transactions" });
  }
});

// 🟢 ADD TRANSACTION (income/expense)
app.post("/transaction", async (req, res) => {
  const { user_id, type, wallet, amount, category, note } = req.body;

  try {
    await pool.query(
      `INSERT INTO transactions 
       (user_id, type, amount, category, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [user_id, type, amount, category, note]
    );

    // optional wallet update (simple logic)
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

// 🟢 TRANSFER (REAL WALLET SYSTEM)
app.post("/transfer", async (req, res) => {
  const { user_id, from, to, amount } = req.body;

  try {
    const result = await pool.query(
      "SELECT * FROM wallets WHERE user_id = $1",
      [user_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    const wallet = result.rows[0];

    const valid = ["main", "savings", "business"];
    if (!valid.includes(from) || !valid.includes(to)) {
      return res.status(400).json({ error: "Invalid wallet type" });
    }

    if (wallet[from] < amount) {
      return res.status(400).json({ error: "Insufficient funds" });
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
      `INSERT INTO transactions
       (user_id, type, amount, category, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        user_id,
        "transfer",
        amount,
        "wallet-transfer",
        `${from} → ${to}`
      ]
    );

    res.json({
      message: "Transfer successful",
      wallets: updated.rows[0]
    });

  } catch (err) {
    console.error("TRANSFER ERROR:", err);
    res.status(500).json({ error: "Transfer failed" });
  }
});

// 🚀 START SERVER
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

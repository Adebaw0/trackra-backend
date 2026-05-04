const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const axios = require("axios");

const app = express();

app.use(cors());
app.use(express.json());

// ================= DATABASE =================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ================= HEALTH =================
app.get("/", (req, res) => {
  res.json({ message: "Trackra API Running 🚀" });
});

// ================= AUTH =================
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
};

// ================= LOGIN =================
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1",
      [email]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = result.rows[0];

    if (user.password !== password) {
      return res.status(401).json({ error: "Invalid password" });
    }

    const token = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET
    );

    res.json({ user, token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= WALLET =================
app.get("/wallets/:user_id", auth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM wallets WHERE user_id = $1",
      [req.params.user_id]
    );

    res.json({ wallets: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= TRANSACTIONS =================
app.get("/transactions/:user_id", auth, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC",
      [req.params.user_id]
    );

    res.json({ transactions: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= TRANSFER =================
app.post("/transfer", auth, async (req, res) => {
  const { user_id, from, to, amount } = req.body;

  try {
    const walletRes = await pool.query(
      "SELECT * FROM wallets WHERE user_id = $1",
      [user_id]
    );

    const wallet = walletRes.rows[0];

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
      `INSERT INTO transactions (user_id, type, amount, note)
       VALUES ($1, $2, $3, $4)`,
      [user_id, "transfer", amount, `${from} → ${to}`]
    );

    res.json({
      message: "Transfer successful",
      wallets: { ...wallet, [from]: newFrom, [to]: newTo },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ================= PAYSTACK INIT =================
app.post("/paystack/init", auth, async (req, res) => {
  const { email, amount } = req.body;

  try {
    const response = await axios.post(
      "https://api.paystack.co/transaction/initialize",
      {
        email,
        amount: amount * 100,
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    res.json(response.data);
  } catch (err) {
    res.status(500).json({
      error: "Payment init failed",
      details: err.message,
    });
  }
});

// ================= PAYSTACK VERIFY + AUTO CREDIT =================
app.get("/paystack/verify/:reference", auth, async (req, res) => {
  try {
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${req.params.reference}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
        },
      }
    );

    const data = response.data.data;

    if (data.status === "success") {
      const email = data.customer.email;
      const amount = data.amount / 100;

      const userResult = await pool.query(
        "SELECT * FROM users WHERE email = $1",
        [email]
      );

      const user = userResult.rows[0];

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      await pool.query(
        "UPDATE wallets SET main = main + $1 WHERE user_id = $2",
        [amount, user.id]
      );

      await pool.query(
        `INSERT INTO transactions (user_id, type, amount, note)
         VALUES ($1, $2, $3, $4)`,
        [user.id, "deposit", amount, "Paystack funding"]
      );

      return res.json({
        message: "Wallet credited successfully",
        amount,
      });
    }

    res.status(400).json({ error: "Payment not successful" });
  } catch (err) {
    res.status(500).json({
      error: "Verification failed",
      details: err.message,
    });
  }
});

// ================= SERVER =================
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Trackra running on port", PORT);
});

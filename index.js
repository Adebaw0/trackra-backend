const express = require("express");
const cors = require("cors");
require("dotenv").config();

const pool = require("./db");

const app = express();

app.use(cors());
app.use(express.json());

/* =========================
   HEALTH CHECK
========================= */
app.get("/", (req, res) => {
  res.send("Trackra API running 🚀");
});

/* =========================
   LOGIN ROUTE
========================= */
app.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      "SELECT * FROM users WHERE email = $1 AND password = $2",
      [email, password]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    res.json({ user: result.rows[0] });

  } catch (err) {
    console.log("LOGIN ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================
   ADD TRANSACTION
========================= */
app.post("/transaction", async (req, res) => {
  try {
    const { user_id, type, amount, category, note } = req.body;

    const result = await pool.query(
      `INSERT INTO transactions (user_id, type, amount, category, note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [user_id, type, amount, category || null, note || null]
    );

    res.json(result.rows[0]);

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================
   GET TRANSACTIONS
========================= */
app.get("/transactions/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;

    const result = await pool.query(
      `SELECT * FROM transactions
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [user_id]
    );

    res.json(result.rows);

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================
   GET BALANCE
========================= */
app.get("/balance/:user_id", async (req, res) => {
  try {
    const { user_id } = req.params;

    const income = await pool.query(
      `SELECT COALESCE(SUM(amount),0) FROM transactions
       WHERE user_id = $1 AND type = 'income'`,
      [user_id]
    );

    const expense = await pool.query(
      `SELECT COALESCE(SUM(amount),0) FROM transactions
       WHERE user_id = $1 AND type = 'expense'`,
      [user_id]
    );

    res.json({
      income: parseFloat(income.rows[0].coalesce),
      expense: parseFloat(expense.rows[0].coalesce),
      balance:
        parseFloat(income.rows[0].coalesce) -
        parseFloat(expense.rows[0].coalesce)
    });

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================
   START SERVER
========================= */
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Trackra running on port ${PORT} 🚀`);
});

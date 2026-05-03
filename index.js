const express = require("express");
const cors = require("cors");
require("dotenv").config();

const pool = require("./db");

const app = express();

app.use(cors());
app.use(express.json());

/**
 * 🟢 HEALTH CHECK
 */
app.get("/", (req, res) => {
  res.send("Trackra API running 🚀");
});

/**
 * ➕ ADD TRANSACTION (income / expense)
 */
app.post("/transaction", async (req, res) => {
  try {
    const { user_id, type, amount, category, note } = req.body;

    if (!user_id || !type || !amount) {
      return res.status(400).json({ error: "Missing required fields" });
    }

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

/**
 * 📜 GET TRANSACTIONS (history)
 */
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
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 💰 GET BALANCE
 */
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

    const incomeTotal = parseFloat(income.rows[0].coalesce);
    const expenseTotal = parseFloat(expense.rows[0].coalesce);

    res.json({
      balance: incomeTotal - expenseTotal,
      income: incomeTotal,
      expense: expenseTotal
    });

  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 🚀 START SERVER
 */
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Trackra running on port ${PORT} 🚀`);
});

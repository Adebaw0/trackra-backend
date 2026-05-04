app.post("/transfer", async (req, res) => {
  const { user_id, from, to, amount, pin } = req.body;

  try {
    // 1. Get user
    const userResult = await pool.query(
      "SELECT * FROM users WHERE id = $1",
      [user_id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = userResult.rows[0];

    // 2. Check PIN
    if (!user.pin) {
      return res.status(400).json({ error: "PIN not set" });
    }

    if (user.pin !== pin) {
      return res.status(401).json({ error: "Invalid PIN" });
    }

    // 3. Get wallet
    const walletResult = await pool.query(
      "SELECT * FROM wallets WHERE user_id = $1",
      [user_id]
    );

    if (walletResult.rows.length === 0) {
      return res.status(404).json({ error: "Wallet not found" });
    }

    const wallet = walletResult.rows[0];

    // 4. Validate wallet types
    const allowed = ["main", "savings", "business"];
    if (!allowed.includes(from) || !allowed.includes(to)) {
      return res.status(400).json({ error: "Invalid wallet type" });
    }

    // 5. Check balance
    if (wallet[from] < amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }

    const newFrom = wallet[from] - amount;
    const newTo = wallet[to] + amount;

    // 6. Update sender wallet
    await pool.query(
      `UPDATE wallets SET ${from} = $1 WHERE user_id = $2`,
      [newFrom, user_id]
    );

    // 7. Update receiver wallet (same user internal transfer)
    await pool.query(
      `UPDATE wallets SET ${to} = $1 WHERE user_id = $2`,
      [newTo, user_id]
    );

    // 8. Log transaction
    await pool.query(
      `INSERT INTO transactions (user_id, type, amount, category, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        user_id,
        "transfer",
        amount,
        "wallet-transfer",
        `${from} → ${to}`
      ]
    );

    // 9. Success response
    res.json({
      message: "Transfer successful (PIN verified)",
      wallets: {
        ...wallet,
        [from]: newFrom,
        [to]: newTo
      }
    });

  } catch (err) {
    console.error("TRANSFER ERROR:", err.message);
    res.status(500).json({
      error: "Transfer failed",
      details: err.message
    });
  }
});

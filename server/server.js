import 'dotenv/config';
import app from './src/app.js';

const PORT = Number(process.env.PORT || 4000);

app.listen(PORT, () => {
  console.log(`API FarmaExpress en http://localhost:${PORT} — documentación en http://localhost:${PORT}/api/docs`);
});

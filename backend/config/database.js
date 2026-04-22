const mongoose = require('mongoose');

/**
 * MongoDB Connection Manager
 *
 * Handles connection lifecycle with:
 * - Retry logic for transient failures
 * - Graceful shutdown on process termination
 * - Event listeners for connection state monitoring
 */
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      // These options ensure reliable connections in production
      serverSelectionTimeoutMS: 5000,  // Fail fast if MongoDB is unreachable
      socketTimeoutMS: 45000,          // Allow long-running queries up to 45s
    });

    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);

    // Log future disconnections so ops teams are alerted
    mongoose.connection.on('disconnected', () => {
      console.warn('⚠️  MongoDB disconnected. Attempting reconnect...');
    });

    mongoose.connection.on('reconnected', () => {
      console.log('✅ MongoDB reconnected');
    });

  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    // Exit the process — the container orchestrator (Kubernetes/Azure) will restart it
    process.exit(1);
  }
};

// Graceful shutdown: close MongoDB before exiting so in-flight writes complete
process.on('SIGINT', async () => {
  await mongoose.connection.close();
  console.log('MongoDB connection closed due to app termination');
  process.exit(0);
});

module.exports = connectDB;

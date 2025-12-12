// index.js in movli-backend

// Use dotenv to load environment variables from .env file
require('dotenv').config();

const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');

// --- Firebase Admin SDK Initialization ---
// IMPORTANT: Make sure the path in your .env file is correct
const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Get a reference to the Firestore database
const db = admin.firestore();

// --- Express App Setup ---
const app = express();
const PORT = process.env.PORT || 3001;
const authMiddleware = require('./authMiddleware'); // For authentication

// Middlewares
app.use(cors()); // Allows requests from your React frontend
app.use(express.json()); // Parses incoming JSON requests
// Apply the middleware to all /api/movies routes
app.use('/api/movies', authMiddleware);

// in movli-backend/index.js

// --- Authentication Middleware ---
const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(403).send('Unauthorized: No token provided.');
  }

  const token = authHeader.split(' ')[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);
    req.uid = decodedToken.uid; // Add the user's ID to the request object
    next(); // Proceed to the next function (the route handler)
  } catch (error) {
    console.error('Error verifying token:', error);
    return res.status(403).send('Unauthorized: Invalid token.');
  }
};

// --- API Routes ---

// POST: Save a new movie (Corrected)
// This now uses the imdbID as the document ID
// GET: Fetch all saved movies for the authenticated user
// in movli-backend/index.js

// GET: Fetch all saved movies for the logged-in user
// This route now uses the verifyToken middleware to identify the user
app.get('/api/movies', verifyToken, async (req, res) => {
  try {
    const { uid } = req; // Get the user's ID from the verified token

    // Correctly point to the user's specific 'savedMovies' subcollection
    const moviesRef = db.collection('users').doc(uid).collection('savedMovies');
    const snapshot = await moviesRef.get();

    if (snapshot.empty) {
      return res.status(200).json([]);
    }

    let movies = [];
    snapshot.forEach(doc => {
      movies.push(doc.data());
    });

    res.status(200).json(movies);
  } catch (error) {
    console.error("Error fetching movies:", error);
    res.status(500).send("Internal Server Error");
  }
});

// POST: Save a new movie for the authenticated user
// in movli-backend/index.js

// POST: Save a new movie for the logged-in user
// This route now uses the verifyToken middleware
app.post('/api/movies', verifyToken, async (req, res) => {
  try {
    const { uid } = req; // Get the user's ID from the verified token
    const movieData = req.body;

    if (!movieData || !movieData.imdbID) {
      return res.status(400).send("Movie data with imdbID is required.");
    }

    // Check if the movie already exists in the user's watchlist to prevent duplicates
    const movieRef = db.collection('users').doc(uid).collection('savedMovies').doc(movieData.imdbID);
    const doc = await movieRef.get();

    if (doc.exists) {
        return res.status(409).send("Movie already exists in your watchlist."); // 409 Conflict
    }

    // If it doesn't exist, save it
    await movieRef.set(movieData);

    res.status(201).json({ id: movieData.imdbID, ...movieData });
  } catch (error) {
    console.error("Error saving movie:", error);
    res.status(500).send("Internal Server Error");
  }
});

// PUT: Update a movie for the authenticated user
app.put('/api/movies/:movieId', verifyToken, async (req, res) => {
  try {
    const { uid } = req;
    const { movieId } = req.params;
    const updates = req.body;

    // Get a reference to the specific movie document in the user's subcollection
    const movieRef = db.collection('users').doc(uid).collection('savedMovies').doc(movieId);

    // Update the document with the new data
    await movieRef.update(updates);

    res.status(200).json({ id: movieId, ...updates });
  } catch (error) {
    console.error('Error updating movie:', error);
    res.status(500).send('Error updating movie');
  }
});

// DELETE: Delete a movie for the authenticated user
app.delete('/api/movies/:movieId', verifyToken, async (req, res) => {
  try {
    const { uid } = req;
    const { movieId } = req.params;

    // Get a reference to the specific movie document and delete it
    await db.collection('users').doc(uid).collection('savedMovies').doc(movieId).delete();

    res.status(200).json({ message: `Movie with id ${movieId} deleted successfully` });
  } catch (error) {
    console.error('Error deleting movie:', error);
    res.status(500).send('Error deleting movie');
  }
});

  // Access the chatbot, now protected and with history
app.post('/api/chat', verifyToken, async (req, res) => {
  try {
    const { prompt } = req.body;
    const { uid } = req; // User ID from token

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required." });
    }

    // --- Save user's message to Firestore ---
    const userMessage = {
      role: 'user',
      content: prompt,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('users').doc(uid).collection('chatHistory').add(userMessage);

    const Replicate = require("replicate");
    console.log('Checking for API Key:', process.env.REPLICATE_API_TOKEN);

    const replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN,
    });

    console.log("Running model with prompt:", prompt);

    const output = await replicate.run(
      "ibm-granite/granite-3.3-8b-instruct",
      {
        input: {
          prompt: prompt,
          max_new_tokens: 1024
        }
      }
    );

    const botReply = output.join("");

    // --- Save bot's reply to Firestore ---
    const botMessage = {
      role: 'bot',
      content: botReply,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('users').doc(uid).collection('chatHistory').add(botMessage);

    res.status(200).json({ reply: botReply });

  } catch (error) {
    console.error("Error with Replicate API or Firestore:", error);
    res.status(500).json({ error: "Failed to get a response from the chatbot." });
  }
});

// GET: Fetch chat history for the authenticated user
app.get('/api/chat/history', verifyToken, async (req, res) => {
  try {
    const { uid } = req;

    const historyRef = db.collection('users').doc(uid).collection('chatHistory').orderBy('timestamp', 'asc');
    const snapshot = await historyRef.get();

    if (snapshot.empty) {
      return res.status(200).json([]);
    }

    let chatHistory = [];
    snapshot.forEach(doc => {
      chatHistory.push(doc.data());
    });

    res.status(200).json(chatHistory);
  } catch (error) {
    console.error("Error fetching chat history:", error);
    res.status(500).send("Internal Server Error");
  }
});


// --- Start Server ---
app.listen(PORT, () => {
  console.log(`Server is running on https://movli-backend.onrender.com:${PORT}`);
});
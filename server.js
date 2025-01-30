require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const cors = require("cors");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");
const twilio = require("twilio");

// Twilio credentials (hardcoded for now, move to environment variables for security)
const accountSid = "AC29edd84ce0d3c92d9d6dee79f10b8a60";
const authToken = "d16fa827410aca4ee6cbae8142500be5";
const twilioPhoneNumber = "+17655483708";
const notificationPhoneNumber = "+918826417060";

// Initialize Twilio client
const client = twilio(accountSid, authToken);

// Initialize Express app
const app = express();

// CORS Configuration
const corsOptions = {
  origin: "http://localhost:3000", 
  methods: "GET,POST",
  allowedHeaders: "Content-Type,Authorization",
};
app.use(cors(corsOptions));

// Middleware
app.use(bodyParser.json());

// MongoDB Connection
mongoose
  .connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("✅ MongoDB connected successfully"))
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err);
    process.exit(1);
  });

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUD_NAME,
  api_key: process.env.CLOUD_API_KEY,
  api_secret: process.env.CLOUD_API_SECRET,
});
console.log("✅ Cloudinary configured successfully");

// MongoDB Schema and Model
const recordingSchema = new mongoose.Schema({
  videoUrl: String,
  latitude: Number,
  longitude: Number,
  time: String,
});

const Recording = mongoose.model("Recording", recordingSchema);

// Multer Storage Configuration
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Routes

// Route: Upload Video and Save Metadata
app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const { latitude, longitude, time } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: "No file uploaded" });
    }
    if (!latitude || !longitude || !time) {
      return res.status(400).json({ error: "Missing metadata (latitude, longitude, or time)" });
    }

    console.log("🌍 Metadata received:", { latitude, longitude, time });

    // Upload video to Cloudinary
    const uploadResponse = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { resource_type: "video" },
        (error, result) => {
          if (error) {
            return reject(error);
          }
          return resolve(result);
        }
      );
      stream.end(file.buffer);
    });

    const videoUrl = uploadResponse.secure_url;
    console.log("✅ Video uploaded to Cloudinary:", videoUrl);

    // Save metadata to MongoDB
    const newRecording = new Recording({ videoUrl, latitude, longitude, time });
    await newRecording.save();
    console.log("✅ Metadata saved successfully:", newRecording);

    // Generate Google Maps link
    const googleMapsLink = `https://www.google.com/maps?q=${latitude},${longitude}`;

    // Send SMS notification
    const message = `New video uploaded!\n\nURL: ${videoUrl}\nLatitude: ${latitude}\nLongitude: ${longitude}\nGoogle Maps: ${googleMapsLink}`;
    try {
      const smsResponse = await client.messages.create({
        body: message,
        from: twilioPhoneNumber,
        to: notificationPhoneNumber,
      });
      console.log("✅ SMS sent successfully:", smsResponse.sid);
    } catch (smsError) {
      console.error("❌ Error sending SMS:", smsError.message);
    }

    res.status(200).json({ message: "Upload successful and SMS sent!", recording: newRecording });
  } catch (error) {
    console.error("❌ Upload error:", error);
    res.status(500).json({ error: "Failed to upload video" });
  }
});

// Route: Fetch All Recordings
app.get("/recordings", async (req, res) => {
  try {
    const recordings = await Recording.find();
    res.status(200).json(recordings);
  } catch (error) {
    console.error("❌ Fetch error:", error);
    res.status(500).json({ error: "Failed to fetch recordings" });
  }
});

// Start the Server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

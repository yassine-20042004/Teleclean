require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/teleclean", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
    .then(() => console.log("✅ MongoDB Connected"))
    .catch(err => console.error("❌ MongoDB Error:", err));

// User Schema
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["cleaner", "householder"], required: true }, // Role: cleaner or householder
    skills: { type: [String], default: [] }, // For cleaners (e.g., cleaning, window cleaning)
    location: { type: String }, // For cleaners and householders
    offers: [{ type: mongoose.Schema.Types.ObjectId, ref: "Offer" }], // For cleaners (their posted offers)
    bookings: [{ type: mongoose.Schema.Types.ObjectId, ref: "Booking" }], // For householders (their booked services)
});

const User = mongoose.model("User", userSchema);

// Offer Schema
const offerSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, required: true },
    price: { type: Number, required: true },
    location: { type: String, required: true },
    postedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // Cleaner who posted the offer
    status: { type: String, enum: ["available", "booked"], default: "available" }, // Offer status
});

const Offer = mongoose.model("Offer", offerSchema);

// Booking Schema
const bookingSchema = new mongoose.Schema({
    offer: { type: mongoose.Schema.Types.ObjectId, ref: "Offer" }, // The offer being booked
    bookedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // Householder who booked the offer
    date: { type: Date, default: Date.now }, // Booking date
    status: { type: String, enum: ["pending", "completed"], default: "pending" }, // Booking status
});

const Booking = mongoose.model("Booking", bookingSchema);

// Serve static HTML files from the "views" folder
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "index.html"));
});

app.get("/login", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "login.html"));
});

app.get("/signup", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "signup.html"));
});

// Fetch Cleaner's Posted Offers
// Fetch Cleaner's Posted Offers
app.get("/cleaner-profile/:id/offers", async (req, res) => {
    const userId = req.params.id;

    try {
        const user = await User.findById(userId).populate("offers");
        res.status(200).json({ offers: user.offers });
    } catch (error) {
        res.status(500).json({ message: "Error fetching offers" });
    }
});
// Serve Cleaner Profile Page
app.get("/cleaner-profile/:id", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "cleaner-profile.html"));
});


// Serve Householder Profile Page
app.get("/householder-profile/:id", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "householder-profile.html"));
});

// Fetch Available Offers for Householder
app.get("/api/householder-profile/:id/offers", async (req, res) => {
    const userId = req.params.id;

    try {
        // Fetch available offers from the database
        const offers = await Offer.find({ status: "available" }).populate("postedBy");

        // Send the offers as a JSON response
        res.status(200).json({ offers });
    } catch (error) {
        res.status(500).json({ message: "Error fetching offers" });
    }
});

// Signup Route
app.post("/signup", async (req, res) => {
    const { name, email, password, role, location } = req.body;

    try {
        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).send("User already exists");
        }

        // Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create a new user
        const user = new User({ name, email, password: hashedPassword, role, location });
        await user.save();

        res.status(201).send("User registered successfully");
    } catch (error) {
        res.status(500).send("Error registering user");
    }
});

// Login Route
app.post("/login", async (req, res) => {
    const { email, password } = req.body;

    try {
        // Find the user by email
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: "Invalid credentials" });
        }

        // Check the password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(400).json({ message: "Invalid credentials" });
        }

        // Send the redirect URL based on role
        if (user.role === "cleaner") {
            res.status(200).json({ redirectUrl: `/cleaner-profile/${user._id}` });
        } else if (user.role === "householder") {
            res.status(200).json({ redirectUrl: `/householder-profile/${user._id}` });
        }
    } catch (error) {
        res.status(500).json({ message: "Error logging in" });
    }
});
// Post Offer Route (Cleaners)
app.post("/post-offer/:userId", async (req, res) => {
    const { title, description, price, location } = req.body;
    const userId = req.params.userId;

    try {
        const offer = new Offer({ title, description, price, location, postedBy: userId });
        await offer.save();

        // Add the offer to the cleaner's profile
        await User.findByIdAndUpdate(userId, { $push: { offers: offer._id } });

        res.status(201).send("Offer posted successfully");
    } catch (error) {
        res.status(500).send("Error posting offer");
    }
});

// Book Offer Route (Householders)
app.post("/book-offer/:offerId/:userId", async (req, res) => {
    const { offerId, userId } = req.params;

    try {
        // Create a booking
        const booking = new Booking({ offer: offerId, bookedBy: userId });
        await booking.save();

        // Update the offer status to "booked"
        await Offer.findByIdAndUpdate(offerId, { status: "booked" });

        // Add the booking to the householder's profile
        await User.findByIdAndUpdate(userId, { $push: { bookings: booking._id } });

        res.status(201).send("Offer booked successfully");
    } catch (error) {
        res.status(500).send("Error booking offer");
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});
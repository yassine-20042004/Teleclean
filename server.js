require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const path = require("path");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});


// Database Connection
mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/teleclean", {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
.then(() => console.log("✅ MongoDB Connected"))
.catch(err => console.error("❌ MongoDB Error:", err));

// Email Transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Schemas
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ["cleaner", "householder"], required: true },
    skills: { type: [String], default: [] },
    location: { type: String },
    offers: [{ type: mongoose.Schema.Types.ObjectId, ref: "Offer" }],
    bookings: [{ type: mongoose.Schema.Types.ObjectId, ref: "Booking" }]
});

const offerSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: { type: String, required: true },
    price: { type: Number, required: true },
    location: { type: String, required: true },
    postedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    status: { type: String, enum: ["available", "booked"], default: "available" }
});

const bookingSchema = new mongoose.Schema({
    offer: { type: mongoose.Schema.Types.ObjectId, ref: "Offer" },
    bookedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    date: { type: Date, default: Date.now },
    status: { type: String, enum: ["pending", "completed"], default: "pending" }
});

const orderSchema = new mongoose.Schema({
    customerName: { type: String, required: true },
    customerEmail: { type: String, required: true },
    customerPhone: { type: String, required: true },
    customerAddress: { type: String, required: true },
    serviceType: { type: String, required: true },
    numberOfRooms: { type: Number, required: true },
    notes: { type: String },
    pricePerHour: { type: Number, required: true },
    estimatedHours: { type: Number, required: true },
    totalPrice: { type: Number, required: true },
    paymentMethod: { type: String, enum: ["cash", "card"], default: "cash" },
    paymentStatus: { type: String, enum: ["pending", "paid", "failed"], default: "pending" },
    status: { type: String, enum: ["new", "assigned", "in_progress", "completed"], default: "new" },
    createdAt: { type: Date, default: Date.now },
    assignedCleaner: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
});

// Models
const User = mongoose.model("User", userSchema);
const Offer = mongoose.model("Offer", offerSchema);
const Booking = mongoose.model("Booking", bookingSchema);
const Order = mongoose.model("Order", orderSchema);

// Utility Functions
const calculateOrderDetails = (service, rooms) => {
    let pricePerHour;
    switch(service) {
        case 'تنظيف المنزل': pricePerHour = 150; break;
        case 'تنظيف السجاد': pricePerHour = 100; break;
        case 'تنظيف النوافذ': pricePerHour = 80; break;
        default: pricePerHour = 100;
    }
    const estimatedHours = Math.max(1, Math.ceil(rooms * 0.5));
    const totalPrice = pricePerHour * estimatedHours;
    return { pricePerHour, estimatedHours, totalPrice };
};

const sendEmail = async (to, subject, html) => {
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to,
            subject,
            html
        });
    } catch (error) {
        console.error("Email sending error:", error);
    }
};

// Static File Routes
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "views", "index.html")));
app.get("/order-service", (req, res) => res.sendFile(path.join(__dirname, "views", "order-service.html")));
app.get("/payment", (req, res) => res.sendFile(path.join(__dirname, "views", "payment.html")));
app.get("/confirmation", (req, res) => res.sendFile(path.join(__dirname, "views", "confirmation.html")));
app.get("/login", (req, res) => res.sendFile(path.join(__dirname, "views", "login.html")));
app.get("/signup", (req, res) => res.sendFile(path.join(__dirname, "views", "signup.html")));
app.get("/cleaner-profile/:id", (req, res) => res.sendFile(path.join(__dirname, "views", "cleaner-profile.html")));
app.get("/householder-profile/:id", (req, res) => res.sendFile(path.join(__dirname, "views", "householder-profile.html")));
app.get("/payment-method", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "payment-method.html"));
});

// API Routes
// User Authentication
app.post("/signup", async (req, res) => {
    try {
        const { name, email, password, role, location } = req.body;
        
        if (await User.findOne({ email })) {
            return res.status(400).json({ error: "User already exists" });
        }

        const user = new User({
            name,
            email,
            password: await bcrypt.hash(password, 10),
            role,
            location
        });

        await user.save();
        res.status(201).json({ message: "User registered successfully" });
    } catch (error) {
        res.status(500).json({ error: "Error registering user" });
    }
});

app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ error: "Invalid credentials" });
        }

        const redirectUrl = user.role === "cleaner" 
            ? `/cleaner-profile/${user._id}` 
            : `/householder-profile/${user._id}`;

        res.json({ redirectUrl });
    } catch (error) {
        res.status(500).json({ error: "Error logging in" });
    }
});

// Submit Order endpoint - MODIFIED
app.post("/submit-order", async (req, res) => {
    try {
        const { name, email, phone, address, service, rooms, notes } = req.body;
        
        // Validate required fields
        if (!name || !email || !phone || !address || !service || !rooms) {
            return res.status(400).json({ 
                success: false,
                error: 'الرجاء ملء جميع الحقول المطلوبة' 
            });
        }

        // Calculate order details
        const { pricePerHour, estimatedHours, totalPrice } = calculateOrderDetails(service, rooms);

        // Create new order - FIXED paymentMethod to use default "cash"
        const newOrder = new Order({
            customerName: name,
            customerEmail: email,
            customerPhone: phone,
            customerAddress: address,
            serviceType: service,
            numberOfRooms: rooms,
            notes: notes || '',
            pricePerHour,
            estimatedHours,
            totalPrice
            // Let paymentMethod use the default "cash" value
            // paymentStatus will use default "pending"
        });

        await newOrder.save();

        // Send success response with CORRECTED redirectUrl
        res.json({ 
            success: true, 
            orderId: newOrder._id,
            redirectUrl: `/payment-method?orderId=${newOrder._id}`
        });

    } catch (error) {
        console.error('Error submitting order:', error);
        res.status(500).json({ 
            success: false,
            error: 'حدث خطأ أثناء معالجة طلبك' 
        });
    }
});

// Process Payment endpoint - FIXED
// Update the process-payment endpoint
app.post("/process-payment", async (req, res) => {
    try {
        const { orderId, paymentMethod, cardDetails, amount } = req.body;
        
        // Validate order exists
        const order = await Order.findById(orderId);
        if (!order) {
            return res.status(404).json({ 
                success: false,
                error: "Order not found" 
            });
        }

        // Validate payment amount matches order total
        const orderTotal = order.totalPrice + ' ر.س'; // Match the format from client
        if (amount && amount !== orderTotal) {
            return res.status(400).json({
                success: false,
                error: "المبلغ لا يتطابق مع قيمة الطلب"
            });
        }

        // Process payment based on method
        if (paymentMethod === "card") {
            // Validate card details
            if (!cardDetails || !cardDetails.number || !cardDetails.expiry || !cardDetails.cvv) {
                return res.status(400).json({
                    success: false,
                    error: "بيانات البطاقة غير مكتملة"
                });
            }

            // In a real app, integrate with payment gateway here
            // This is just a simulation
            const paymentSuccess = simulateCardPayment(cardDetails, order.totalPrice);
            
            if (!paymentSuccess) {
                return res.status(400).json({
                    success: false,
                    error: "رفضت عملية الدفع. يرجى التحقق من بيانات البطاقة"
                });
            }

            order.paymentStatus = "paid";
        } else {
            order.paymentStatus = "pending";
        }

        order.paymentMethod = paymentMethod;
        await order.save();

        // Send confirmation email
        await sendPaymentConfirmationEmail(order);

        res.json({ 
            success: true, 
            redirectUrl: `/confirmation?orderId=${order._id}`,
            message: "تمت عملية الدفع بنجاح"
        });

    } catch (error) {
        console.error('Payment processing error:', error);
        res.status(500).json({ 
            success: false,
            error: "حدث خطأ أثناء معالجة الدفع" 
        });
    }
});

// Helper function to simulate card payment
function simulateCardPayment(cardDetails, amount) {
    // Simple simulation - in reality you'd call a payment gateway
    console.log(`Simulating payment of ${amount} with card ending in ${cardDetails.number.slice(-4)}`);
    
    // Simulate 80% success rate for demo purposes
    return Math.random() > 0.2;
}

// Email sending function for payment confirmation
async function sendPaymentConfirmationEmail(order) {
    const subject = `تم تأكيد طلبك #${order._id}`;
    const html = `
        <div dir="rtl">
            <h2>شكراً لاستخدامك تيلكلين</h2>
            <p>تم تأكيد طلبك بنجاح وسيتم التواصل معك قريباً لتحديد الموعد.</p>
            <h3>تفاصيل الطلب:</h3>
            <ul>
                <li>رقم الطلب: ${order._id}</li>
                <li>نوع الخدمة: ${order.serviceType}</li>
                <li>المبلغ: ${order.totalPrice} ر.س</li>
                <li>طريقة الدفع: ${order.paymentMethod === 'card' ? 'بطاقة ائتمان' : 'نقداً عند الاستلام'}</li>
            </ul>
        </div>
    `;
    
    await sendEmail(order.customerEmail, subject, html);
}
// Data Fetching Routes
app.get("/api/orders/:orderId", async (req, res) => {
    try {
        const order = await Order.findById(req.params.orderId);
        order ? res.json(order) : res.status(404).json({ error: "Order not found" });
    } catch (error) {
        res.status(500).json({ error: "Error fetching order" });
    }
});

app.get("/cleaner-profile/:id/offers", async (req, res) => {
    try {
        const user = await User.findById(req.params.id).populate("offers");
        res.json({ offers: user?.offers || [] });
    } catch (error) {
        res.status(500).json({ error: "Error fetching offers" });
    }
});

app.get("/api/householder-profile/:id/offers", async (req, res) => {
    try {
        const offers = await Offer.find({ status: "available" }).populate("postedBy");
        res.json({ offers });
    } catch (error) {
        res.status(500).json({ error: "Error fetching offers" });
    }
});

// Offer Management
app.post("/post-offer/:userId", async (req, res) => {
    try {
        const { title, description, price, location } = req.body;
        const offer = new Offer({
            title,
            description,
            price,
            location,
            postedBy: req.params.userId
        });

        await offer.save();
        await User.findByIdAndUpdate(req.params.userId, { $push: { offers: offer._id } });
        res.status(201).json({ message: "Offer posted successfully" });
    } catch (error) {
        res.status(500).json({ error: "Error posting offer" });
    }
});

app.post("/book-offer/:offerId/:userId", async (req, res) => {
    try {
        const booking = new Booking({
            offer: req.params.offerId,
            bookedBy: req.params.userId
        });

        await booking.save();
        await Offer.findByIdAndUpdate(req.params.offerId, { status: "booked" });
        await User.findByIdAndUpdate(req.params.userId, { $push: { bookings: booking._id } });
        res.status(201).json({ message: "Offer booked successfully" });
    } catch (error) {
        res.status(500).json({ error: "Error booking offer" });
    }
});

// Start Server
app.listen(PORT, () => console.log(`🚀 Server running on http://localhost:${PORT}`));
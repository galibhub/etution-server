const express = require("express");
const cors = require("cors");
const app = express();
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET);

const port = process.env.PORT || 3000;

const admin = require("firebase-admin");

// const serviceAccount = require("./etution-firebase-adminsdk.json");



const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8')
const serviceAccount = JSON.parse(decoded);





admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

//middleware
app.use(express.json());
app.use(cors());

// ===== Firebase Token Verify Middleware =====
const verifyFBToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized Access" });
  }

  try {
    const idToken = authHeader.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    console.error("verifyFBToken error:", err);
    return res.status(401).send({ message: "Unauthorized Access" });
  }
};

//mongodb
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@web-projects.djmog22.mongodb.net/?appName=web-projects`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("etution_db");
    const usersCollection = db.collection("users");
    const tutuionCollection = db.collection("tutions");
    const applicationsCollection = db.collection("applications");
    const paymentsCollection = db.collection("payments");

    // ================= ROLE VERIFY MIDDLEWARE =================

    const verifyAdmin = async (req, res, next) => {
      try {
        const email = req.decoded_email;
        if (!email) {
          return res.status(401).send({ message: "Unauthorized" });
        }

        const user = await usersCollection.findOne({ email });

        if (!user || user.role !== "admin") {
          return res.status(403).send({ message: "Forbidden: Admin only" });
        }

        next();
      } catch (err) {
        console.error("verifyAdmin error:", err);
        return res.status(500).send({ message: "Server error" });
      }
    };

    // users related api for register
    app.post("/users", async (req, res) => {
      try {
        const user = req.body;

        const query = { email: user.email };
        const existingUser = await usersCollection.findOne(query);

        if (existingUser) {
          return res.send({ message: "user already exists" });
        }

        user.createdAt = new Date();
        user.status = "active";

        const result = await usersCollection.insertOne(user);
        res.send({ success: true, insertedId: result.insertedId });
      } catch (error) {
        console.log(error);
        res
          .status(500)
          .send({ success: false, message: "Internal server error" });
      }
    });

    // ---- GET single user's role by email ----
    app.get("/users/role/:email", async (req, res) => {
      try {
        const email = req.params.email;
        const user = await usersCollection.findOne({ email });

        if (!user) {
          return res.send({
            role: "student",
            message: "User not found, default student",
          });
        }

        res.send({ role: user.role || "student" });
      } catch (error) {
        console.error("Error fetching user role:", error);
        res.status(500).send({ error: "Failed to fetch user role" });
      }
    });

    // Get single user by email (for Profile Settings)
    app.get("/users/:email", verifyFBToken, async (req, res) => {
      try {
        const email = req.params.email;

        // 🔒 Only allow logged-in user to access their own data
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "Forbidden" });
        }

        const user = await usersCollection.findOne({ email });

        if (!user) {
          // 404 na diye ekta default user object pathacchi
          return res.send({
            email,
            name: "",
            photoURL: "",
            phone: "",
            role: "student",
            status: "active",
            createdAt: new Date(),
          });
        }

        res.send(user);
      } catch (error) {
        console.error("Error fetching user:", error);
        res.status(500).send({ error: "Failed to fetch user" });
      }
    });

    // Update user profile (name, photoURL, phone etc.)
    app.patch("/users/:email", verifyFBToken, async (req, res) => {
      try {
        const email = req.params.email;

        
        if (email !== req.decoded_email) {
          return res.status(403).send({ message: "Forbidden" });
        }

        const updateData = req.body;

        const filter = { email };
        const updateDoc = {
          $set: updateData,
        };

        const result = await usersCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        console.error("Error updating user profile:", error);
        res.status(500).send({ error: "Failed to update user profile" });
      }
    });

    //-------------tuition related apis-----------------

    // PATCH route - Update tuition status (approve/reject)
    app.patch("/tutions/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const updateInfo = req.body;
        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: updateInfo,
        };

        const result = await tutuionCollection.updateOne(filter, updateDoc);
        res.send(result);
      } catch (error) {
        console.error("Error updating tuition:", error);
        res.status(500).send({ error: "Failed to update tuition" });
      }
    });

    // DELETE route - Delete tuition
    app.delete("/tutions/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await tutuionCollection.deleteOne(query);
        res.send(result);
      } catch (error) {
        console.error("Error deleting tuition:", error);
        res.status(500).send({ error: "Failed to delete tuition" });
      }
    });

    // GET route - Get tuitions (status + studentEmail + search + filters + sort)
    app.get("/tutions", async (req, res) => {
      try {
        const {
          status,
          studentEmail,
          search,
          sortField,
          sortOrder,
          classLevel,
          subject,
          location,
        } = req.query;

        const query = {};

        if (status) {
          query.status = status;
        }

        if (studentEmail) {
          query.studentEmail = studentEmail;
        }

        if (classLevel) {
          query.classLevel = classLevel;
        }

        if (subject) {
          query.subject = new RegExp(subject, "i");
        }

        if (location) {
          query.location = new RegExp(location, "i");
        }

        if (search) {
          const regex = new RegExp(search, "i");
          query.$or = [
            { title: regex },
            { subject: regex },
            { location: regex },
          ];
        }

        // ---- Sort options (budget/date) ----
        // default: latest first
        let sortOptions = { createdAt: -1 };

        // sortField: "salary" / "createdAt"
        if (sortField) {
          const order = sortOrder === "asc" ? 1 : -1;
          sortOptions = {
            [sortField]: order,
          };
        }

        const result = await tutuionCollection
          .find(query)
          .sort(sortOptions)
          .toArray();

        res.send(result);
      } catch (error) {
        console.error("Error fetching tuitions:", error);
        res.status(500).send({ error: "Failed to fetch tuitions" });
      }
    });

    //tuition by specific id

    app.get("/tutions/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const tuition = await tutuionCollection.findOne(query);
        res.send(tuition);
      } catch (error) {
        console.error("Error fetching tuition details:", error);
        res.status(500).send({ error: "Failed to fetch tuition details" });
      }
    });

    // post tutiton

    app.post("/tutions",  async (req, res) => {
      try {
        const tution = req.body;

        tution.createdAt = new Date();
        tution.status = tution.status || "pending";

        const result = await tutuionCollection.insertOne(tution);
        res.send(result);
      } catch (error) {
        console.error("Error creating tuition:", error);
        res.status(500).send({ error: "Failed to create tuition" });
      }
    });

    // GET tutors (for home + all tutors page)
    app.get("/tutors/latest", async (req, res) => {
      try {
        const limit = parseInt(req.query.limit);

        const query = { role: "tutor", status: "active" };

        let cursor = usersCollection.find(query).sort({ createdAt: -1 });

        if (!isNaN(limit)) {
          cursor = cursor.limit(limit);
        }

        const result = await cursor.toArray();
        res.send(result);
      } catch (error) {
        console.error("Error fetching tutors:", error);
        res.status(500).send({ error: "Failed to fetch tutors" });
      }
    });

    // Tutor applies for a tuition
    app.post("/applications", verifyFBToken, async (req, res) => {
      try {
        const application = req.body;

        application.status = "pending";
        application.createdAt = new Date();

        const result = await applicationsCollection.insertOne(application);
        res.send(result);
      } catch (error) {
        console.error("Error creating application:", error);
        res.status(500).send({ error: "Failed to create application" });
      }
    });

    // Get applications for student OR tutor
    app.get("/applications", verifyFBToken, async (req, res) => {
      try {
        const { studentEmail, tutorEmail, status } = req.query;
        const query = {};

        if (studentEmail) {
          query.studentEmail = studentEmail;
        }
        if (tutorEmail) {
          query.tutorEmail = tutorEmail;
        }
        if (status) {
          query.status = status;
        }

        const result = await applicationsCollection
          .find(query)
          .sort({ createdAt: -1 })
          .toArray();

        res.send(result);
      } catch (error) {
        console.error("Error fetching applications:", error);
        res.status(500).send({ error: "Failed to fetch applications" });
      }
    });

    //get specific application by id

    app.get("/applications/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const application = await applicationsCollection.findOne(query);

        if (!application) {
          return res.status(404).send({ error: "Application not found" });
        }

        res.send(application);
      } catch (error) {
        console.error("Error fetching application:", error);
        res.status(500).send({ error: "Failed to fetch application" });
      }
    });

    // Update application (status / expectedSalary / etc.)
    app.patch("/applications/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const updateFields = req.body; 

        const filter = { _id: new ObjectId(id) };
        const updateDoc = {
          $set: updateFields,
        };

        const result = await applicationsCollection.updateOne(
          filter,
          updateDoc
        );
        res.send(result);
      } catch (error) {
        console.error("Error updating application:", error);
        res.status(500).send({ error: "Failed to update application" });
      }
    });

    // Delete an application (tutor can delete before approved)
    app.delete("/applications/:id", verifyFBToken, async (req, res) => {
      try {
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };

        const result = await applicationsCollection.deleteOne(filter);
        res.send(result);
      } catch (error) {
        console.error("Error deleting application:", error);
        res.status(500).send({ error: "Failed to delete application" });
      }
    });

    //--------------------------payment-related api-----------------------

    // Create Stripe checkout session
    app.post("/create-checkout-session", verifyFBToken, async (req, res) => {
      try {
        const {
          applicationId,
          amount,
          tutorEmail,
          studentEmail,
          tuitionTitle,
        } = req.body;

        // Basic validation
        if (!applicationId || !amount || !tutorEmail || !studentEmail) {
          return res.status(400).send({ error: "Missing payment info" });
        }

        // Stripe session create
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          line_items: [
            {
              price_data: {
                currency: "bdt",
                product_data: {
                  name: `Tuition payment for ${tuitionTitle || "Tutor"}`,
                },
                unit_amount: Number(amount) * 100, // stripe amount in poisha
              },
              quantity: 1,
            },
          ],
          success_url: `${process.env.SITE_DOMAIN}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/payment/cancel`,
          metadata: {
            applicationId,
            tutorEmail,
            studentEmail,
          },
        });

        res.send({ url: session.url });
      } catch (error) {
        console.error("Error creating checkout session:", error);
        res.status(500).send({ error: "Failed to create checkout session" });
      }
    });

    // Handle payment success: approve application + save payment info

    app.patch("/payment-success",  async (req, res) => {
      try {
        const sessionId = req.query.session_id;
        if (!sessionId) {
          return res.status(400).send({ error: "Missing session_id" });
        }

        // Stripe theke session info niye ashi
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        const applicationId = session.metadata?.applicationId;
        const tutorEmail = session.metadata?.tutorEmail;
        const studentEmail = session.metadata?.studentEmail;
        const transactionId = session.payment_intent; // 👉 ekbare variable e nilam

        if (!applicationId) {
          return res
            .status(400)
            .send({ error: "No application info in session" });
        }

        const existingPayment = await paymentsCollection.findOne({
          transactionId,
        });

        if (existingPayment) {
          return res.send({
            message: "Payment already processed",
            transactionId: existingPayment.transactionId,
            trackingId: existingPayment.trackingId,
            amount: existingPayment.amount,
          });
        }

        const trackingId = "ETU-" + Date.now().toString(36).toUpperCase();

        const filter = { _id: new ObjectId(applicationId) };
        const updateDoc = {
          $set: {
            status: "approved",
            paymentStatus: "paid",
            transactionId: transactionId,
            trackingId: trackingId,
            paidAmount: session.amount_total / 100,
            paidAt: new Date(),
          },
        };

        await applicationsCollection.updateOne(filter, updateDoc);

        const paymentDoc = {
          applicationId: new ObjectId(applicationId),
          transactionId: transactionId,
          trackingId: trackingId,
          amount: session.amount_total / 100,
          currency: session.currency,
          tutorEmail,
          studentEmail,
          createdAt: new Date(),
        };

        await paymentsCollection.insertOne(paymentDoc);

        res.send({
          message: "Payment success & application approved",
          transactionId: transactionId,
          trackingId: trackingId,
          amount: session.amount_total / 100,
        });
      } catch (error) {
        console.error("Error in payment-success:", error);
        res.status(500).send({ error: "Failed to process payment success" });
      }
    });

    //--payment for tutor

    app.get("/payments/tutor", verifyFBToken, async (req, res) => {
      try {
        const email = req.query.email;

        if (!email) {
          return res.status(400).send({ error: "Tutor email is required" });
        }

        const payments = await paymentsCollection
          .find({ tutorEmail: email })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(payments);
      } catch (error) {
        console.error("Error fetching tutor payments:", error);
        res.status(500).send({ error: "Failed to fetch tutor payments" });
      }
    });

    //  Get payments made by a student
    app.get("/payments/student", verifyFBToken, async (req, res) => {
      try {
        const email = req.query.email;

        if (!email) {
          return res.status(400).send({ error: "Student email is required" });
        }

        const payments = await paymentsCollection
          .find({ studentEmail: email })
          .sort({ createdAt: -1 })
          .toArray();

        res.send(payments);
      } catch (error) {
        console.error("Error fetching student payments:", error);
        res.status(500).send({ error: "Failed to fetch student payments" });
      }
    });

    //---------------------admin api-------------------------------

    // Get all users (Admin)
    app.get("/admin/users", verifyFBToken,verifyAdmin,  async (req, res) => {
      try {
        const users = await usersCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();
        res.send(users);
      } catch (error) {
        res.status(500).send({ error: "Failed to fetch users" });
      }
    });

    // Update user (Admin)
    app.patch(
      "/admin/users/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;
          const updateData = req.body;

          const result = await usersCollection.updateOne(
            { _id: new ObjectId(id) },
            { $set: updateData }
          );

          res.send(result);
        } catch (error) {
          res.status(500).send({ error: "Failed to update user" });
        }
      }
    );

    // Delete user (Admin)
    app.delete(
      "/admin/users/:id",
      verifyFBToken,
      verifyAdmin,
      async (req, res) => {
        try {
          const id = req.params.id;

          const result = await usersCollection.deleteOne({
            _id: new ObjectId(id),
          });

          res.send(result);
        } catch (error) {
          res.status(500).send({ error: "Failed to delete user" });
        }
      }
    );

    app.get("/admin/reports", verifyFBToken, verifyAdmin, async (req, res) => {
      try {
        const payments = await paymentsCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray();

        const totalEarnings = payments.reduce((sum, p) => sum + p.amount, 0);

        res.send({
          totalEarnings,
          totalTransactions: payments.length,
          payments,
        });
      } catch (error) {
        res.status(500).send({ error: "Failed to load reports" });
      }
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("eTution is Running ");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

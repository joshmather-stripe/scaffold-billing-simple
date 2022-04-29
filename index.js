const express = require('express');
const app = express();
//const { resolve } = require('path');
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');

// Replace if using a different env file or config
require('dotenv').config({ path: './.env' });

// {{{ configuration checking
if (
  !process.env.STRIPE_SECRET_KEY ||
  !process.env.STRIPE_PUBLISHABLE_KEY
) {
  console.log(
    'The .env file is not configured. Follow the instructions in the readme to configure the .env file. https://github.com/stripe-samples/subscription-use-cases'
  );
  console.log('');
  process.env.STRIPE_SECRET_KEY
    ? ''
    : console.log('Add STRIPE_SECRET_KEY to your .env file.');

  process.env.STRIPE_PUBLISHABLE_KEY
    ? ''
    : console.log('Add STRIPE_PUBLISHABLE_KEY to your .env file.');

  process.exit();
}
// }}}

// {{{ stripe api
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2020-08-27',
  appInfo: { // For sample support and debugging, not required for production:
    name: "stripe-samples/subscription-use-cases/fixed-price",
    version: "0.0.1",
    url: "https://github.com/stripe-samples/subscription-use-cases/fixed-price"
  }
});
// }}}

// {{{ Use cookies to simulate logged in user.
app.use(cookieParser());
// }}}

// {{{ Use JSON parser for parsing payloads as JSON on all non-webhook routes.
app.use((req, res, next) => {
  if (req.originalUrl === '/webhook') {
    next();
  } else {
    bodyParser.json()(req, res, next);
  }
});

app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded
// }}}

// {{{ Use static to serve static assets.
app.set("view engine", "hbs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, 'public')))
// }}}

// {{{ Use JSON parser for parsing payloads as JSON on all non-webhook routes.
app.use((req, res, next) => {
  if (req.originalUrl === '/webhook') {
    next();
  } else {
    bodyParser.json()(req, res, next);
  }
});
// }}}

app.get('/', (req, res) => {
  res.render("index", {home: "Welcome"});
});

// {{{ render checkout button
app.get('/recurring', async (req, res) => {
  let freeTrial = false;
  if(req.query['free-trial']) freeTrial = {period: req.query['free-trial']};
  console.log("amount: ", freeTrial);
  return res.render('recurring', {
    price: process.env.BASIC_MONTHLY,
    pk: process.env.STRIPE_PUBLISHABLE_KEY,
    ft: freeTrial
  });
});
// }}}

// {{{ subsciription
app.get('/subscription', async (req, res) => {

  let freeTrial = false;
  if(req.cookies['freeTrial']) freeTrial = {period: req.cookies['freeTrial']};

  return res.render('subscription', {
    customer: req.cookies['customer'],
    price: process.env.BASIC_MONTHLY,
    ft: freeTrial
  });
});
// }}}

// {{{ create customer
app.post('/create-customer', async (req, res) => {
  try {
    const customer = await stripe.customers.create({
      email: req.body.email,
    });

    res.cookie('customer', customer.id, { maxAge: 900000, httpOnly: false });
    if(req.body['freeTrial'])
      res.cookie('freeTrial', req.body['freeTrial'], { maxAge: 900000, httpOnly: false });

    return res.redirect('/subscription')

  } catch(e) {
    return res.send(e);
  }
});
// }}}

// {{{ subscribe
app.get('/subscribe', async (req, res) => {

  let freeTrial = false;
  if(req.query['free-trial']) freeTrial = {period: req.query['free-trial']};

  return res.render('subscribe', {
    subscription: req.cookies['subscription'],
    clientSecret: req.cookies['clientSecret'],
    pk: process.env.STRIPE_PUBLISHABLE_KEY,
    price: process.env.BASIC_MONTHLY,
    ft: freeTrial
  });
});
// }}}

// {{{ create subscription
app.post('/create-subscription', async (req, res) => {

  try {
    const subscription = await stripe.subscriptions.create({
      customer: req.body.customerId,
      items: [{
        price: req.body.priceId,
      }],
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
    });


    res.cookie('subscription', subscription.id, { maxAge: 900000, httpOnly: false });
    res.cookie('clientSecret', subscription.latest_invoice.payment_intent.client_secret, { maxAge: 900000, httpOnly: false });

    return res.redirect('/subscribe');

  } catch(e) {
    console.log(e);
    return res.status(400).send({ e: { message: e.message } });
  }
});
// }}}

// {{{ create trial subscription
app.post('/create-trial-subscription', async (req, res) => {
  //NOTE: requires modifications on the subscribe template to use setup intents
  try {
    const subscription = await stripe.subscriptions.create({
      customer: req.body.customerId,
      items: [{
        price: req.body.priceId,
      }],
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
      trial_period_days: req.body.freeTrial,
    });


    res.cookie('subscription', subscription.id, { maxAge: 900000, httpOnly: false });

    //create a setup intent
    const setupIntent = await stripe.setupIntents.create({
      customer: req.cookies['customer'],
      payment_method_types: ['card'],
    });

    res.cookie('clientSecret', setupIntent.client_secret, { maxAge: 900000, httpOnly: false });
    return res.redirect('/subscribe?freeTrial='+req.body.freeTrial);

  } catch(e) {
    console.log(e);
    return res.status(400).send({ e: { message: e.message } });
  }
});
// }}}

// {{{ complete
app.get('/complete', async (req, res) => {
  res.render('complete')
});
// }}}

// {{{ canceled
app.get('/canceled', async (req, res) => {
  res.render('canceled')
});
// }}}

// {{{ render checkout button
app.get('/checkout', async (req, res) => {
  res.render('checkout-sub', {
    price: process.env.BASIC_MONTHLY,
    pk: process.env.STRIPE_PUBLISHABLE_KEY
  });
});
// }}}

// {{{ create checkout session
app.post('/create-checkout-session', async (req, res) => {
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    subscription_data: {
      trial_period_days: 7,
    },
    line_items: [
      {
        price: process.env.BASIC_MONTHLY,
        // For metered billing, do not pass quantity
        quantity: 1,
      },
    ],
    // {CHECKOUT_SESSION_ID} is a string literal; do not change it!
    // the actual Session ID is returned in the query parameter when your customer
    // is redirected to the success page.
    success_url: 'http://localhost:3000/complete/?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: 'http://localhost:3000/canceled',
  });
  return res.redirect(303, session.url);
});
// }}}

// {{{ create invoice manual BASIC/MONTH or PREMIUM/ANNUAL or ....
app.get('/create-invoice/:prod/:price', async (req, res) => {
  const product = req.params.prod.toUpperCase();
  const price = req.params.price.toUpperCase()
  const invoicePrice = product + '_' + price;

  try {
    const invoiceItem = await stripe.invoiceItems.create({
      customer: process.env.TEST_CUST,
      price: process.env[invoicePrice],
    });

    const invoice = await stripe.invoices.create({
      customer: process.env.TEST_CUST,
      collection_method: 'send_invoice',
      days_until_due: 30
    });

    return res.send(invoice);
  } catch(e) {
    console.log(e)
    return res.send(e);
  }

});
// }}}

// {{{ webhooks
app.post(
  '/webhook',
  bodyParser.raw({ type: 'application/json' }),
  async (req, res) => {
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.header('Stripe-Signature'),
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (e) {
      console.log(e);
      console.log(`⚠️  Webhook signature verification failed.`);
      console.log(
        `⚠️  Check the env file and enter the correct webhook secret.`
      );
      return res.sendStatus(400);
    }

    const dataObject = event.data.object;

    switch(event.type) {
      case 'invoice.created':
        console.log('webhook invoice created')
        break;
      case 'invoice.payment_succeeded':
        break;
      default:
        break;
    }

    res.sendStatus(200);
  }
);
// }}}

app.listen(3000, () => console.log(`Node server listening on port http://localhost:${3000}!`));

// Mock MT5 Trading Engine — simulates real-time forex prices and trade management
// Replace price feeds with real MT5 API when budget allows

const EventEmitter = require('events');

class TradingEngine extends EventEmitter {
  constructor() {
    super();
    this.prices = {
      'EURUSD': { bid: 1.08210, ask: 1.08225, digits: 5, point: 0.00001, contract: 100000, spread: 1.5 },
      'GBPUSD': { bid: 1.27340, ask: 1.27360, digits: 5, point: 0.00001, contract: 100000, spread: 2.0 },
      'USDJPY': { bid: 149.820, ask: 149.835, digits: 3, point: 0.001, contract: 100000, spread: 1.5 },
      'AUDUSD': { bid: 0.65180, ask: 0.65195, digits: 5, point: 0.00001, contract: 100000, spread: 1.5 },
      'USDCHF': { bid: 0.90120, ask: 0.90135, digits: 5, point: 0.00001, contract: 100000, spread: 1.5 },
      'USDCAD': { bid: 1.36210, ask: 1.36230, digits: 5, point: 0.00001, contract: 100000, spread: 2.0 },
      'NZDUSD': { bid: 0.59870, ask: 0.59890, digits: 5, point: 0.00001, contract: 100000, spread: 2.0 },
      'EURJPY': { bid: 162.150, ask: 162.170, digits: 3, point: 0.001, contract: 100000, spread: 2.5 },
      'GBPJPY': { bid: 189.630, ask: 189.660, digits: 3, point: 0.001, contract: 100000, spread: 3.0 },
      'EURGBP': { bid: 0.85020, ask: 0.85040, digits: 5, point: 0.00001, contract: 100000, spread: 2.0 },
      'XAUUSD': { bid: 2034.50, ask: 2035.00, digits: 2, point: 0.01, contract: 100, spread: 50 },
      'XAGUSD': { bid: 22.450, ask: 22.480, digits: 3, point: 0.001, contract: 5000, spread: 3.0 },
      'BTCUSD': { bid: 43250.0, ask: 43300.0, digits: 1, point: 0.1, contract: 1, spread: 50 },
      'ETHUSD': { bid: 2287.5, ask: 2289.5, digits: 2, point: 0.01, contract: 1, spread: 20 },
      'USOUSD': { bid: 78.450, ask: 78.480, digits: 3, point: 0.001, contract: 1000, spread: 3.0 },
      'US30':   { bid: 38420.0, ask: 38425.0, digits: 1, point: 0.1, contract: 1, spread: 5 },
      'US500':  { bid: 4984.5, ask: 4985.5, digits: 2, point: 0.01, contract: 1, spread: 1.0 },
      'NAS100': { bid: 17650.0, ask: 17653.0, digits: 1, point: 0.1, contract: 1, spread: 3.0 },
      'GER40':  { bid: 17280.0, ask: 17284.0, digits: 1, point: 0.1, contract: 1, spread: 4.0 },
    };

    this.volatility = {
      'EURUSD': 0.00005, 'GBPUSD': 0.00007, 'USDJPY': 0.005, 'AUDUSD': 0.00006,
      'USDCHF': 0.00005, 'USDCAD': 0.00006, 'NZDUSD': 0.00006, 'EURJPY': 0.006,
      'GBPJPY': 0.008, 'EURGBP': 0.00004, 'XAUUSD': 0.30, 'XAGUSD': 0.008,
      'BTCUSD': 80.0, 'ETHUSD': 5.0, 'USOUSD': 0.05, 'US30': 15.0,
      'US500': 2.0, 'NAS100': 20.0, 'GER40': 12.0,
    };

    this.ticketCounter = 100000;
    this.startPriceEngine();
  }

  startPriceEngine() {
    setInterval(() => {
      const updates = {};
      for (const [symbol, data] of Object.entries(this.prices)) {
        const vol = this.volatility[symbol] || 0.0001;
        // Gaussian-like random walk
        const r1 = Math.random(), r2 = Math.random();
        const gauss = Math.sqrt(-2 * Math.log(r1)) * Math.cos(2 * Math.PI * r2);
        const change = gauss * vol * 0.3;
        const spread = data.ask - data.bid;
        const newBid = parseFloat((data.bid + change).toFixed(data.digits));
        if (newBid > 0) {
          this.prices[symbol].bid = newBid;
          this.prices[symbol].ask = parseFloat((newBid + spread).toFixed(data.digits));
          updates[symbol] = { bid: this.prices[symbol].bid, ask: this.prices[symbol].ask };
        }
      }
      this.emit('prices', updates);
    }, 800);
  }

  getPrice(symbol) {
    return this.prices[symbol] || null;
  }

  getAllPrices() {
    const result = {};
    for (const [symbol, data] of Object.entries(this.prices)) {
      result[symbol] = { bid: data.bid, ask: data.ask, digits: data.digits, spread: parseFloat((data.ask - data.bid).toFixed(data.digits)) };
    }
    return result;
  }

  getNextTicket() {
    return ++this.ticketCounter;
  }

  calculateProfit(symbol, type, volume, openPrice, currentPrice) {
    const data = this.prices[symbol];
    if (!data) return 0;
    let priceDiff = type === 'buy' ? currentPrice - openPrice : openPrice - currentPrice;
    // For JPY pairs, pip value is different
    let pipValue = 10; // USD per pip per standard lot
    if (symbol.includes('JPY')) pipValue = 1000 / currentPrice * 10;
    else if (symbol === 'XAUUSD') pipValue = 1;
    else if (symbol === 'XAGUSD') pipValue = 50;
    else if (symbol === 'BTCUSD' || symbol === 'ETHUSD') pipValue = volume;
    else if (['US30','US500','NAS100','GER40'].includes(symbol)) pipValue = volume;
    else if (symbol === 'USOUSD') pipValue = volume * 1000;
    const profit = priceDiff * data.contract * volume;
    return parseFloat(profit.toFixed(2));
  }

  getMarketInfo(symbol) {
    const data = this.prices[symbol];
    if (!data) return null;
    return {
      symbol,
      bid: data.bid,
      ask: data.ask,
      digits: data.digits,
      spread: parseFloat((data.ask - data.bid).toFixed(data.digits)),
      contract_size: data.contract,
      margin_required: (data.ask * data.contract * 0.01).toFixed(2),
    };
  }
}

const engine = new TradingEngine();
module.exports = engine;

const _ = require("lodash");
const fs = require("fs");
const R = require("ramda");
const moment = require("moment");
var path = require("path");

// TODO:
// * Commit only neccesary files to:
// git@github.com:benjamin-glitsos/gekko-plotly-plugin.git
// * Write quick readme

// Gekko imports --------------------

const log = require("../core/log");
const util = require("../core/util.js");
const env = util.gekkoEnv();

const defaults = {};

defaults.plotly = {
    write: {
        enabled: true,
        path: ""
    },
    layout: {
        autosize: true,
        height: 620,
        width: null,
        legendOrientation: "h",
        buttons: {
            day: [1, 5, 10],
            week: [1],
            month: [1, 3, 6],
            year: [1, 3]
        },
        additional: {}
    },
    data: {
        price: {
            enabled: true,
            color: "blue",
            width: 2,
            opacity: 0.75
        },
        trades: {
            enabled: true,
            buy: {
                color: "green",
                opacity: 0.9,
                size: 10
            },
            sell: {
                color: "red",
                opacity: 0.9,
                size: 10
            }
        },
        volume: {
            enabled: true,
            color: "purple",
            width: 2,
            opacity: 0.8
        },
        strategy: {
            enabled: true,
            indicators: {}
        }
    }
};

const config = R.mergeDeepRight(defaults, util.getConfig());

// Utilities --------------------

const isNull = i => i === null;

const rejectNulls = x => R.reject(isNull, x);

// List of objects to a list based on one property
const propList = (prop, obj) => R.map(i => i[prop], obj);

// List of objects to a list based on one property where another property equals a value
const propListWhere = (prop, whereProp, whereVal, obj) => {
    return rejectNulls(
        R.map(i => {
            if (i[whereProp] === whereVal) {
                return i[prop];
            } else {
                return null;
            }
        }, obj)
    );
};

// List of object trees to a list
const propPathList = (path, ls) => R.map(R.view(R.lensPath(path)), ls);

const jstr = JSON.stringify;

const plotlyDate = unixDate => {
    const isoDate = new Date(unixDate * 1000);
    const plotlyFormat = "YYYY-MM-DD HH";
    return moment(isoDate).format(plotlyFormat);
};

const plotlyDates = unixDates => R.map(plotlyDate, unixDates);

// Plotly --------------------

const Plotly = function() {
    this.candles = [];
    this.trades = [];
    this.strategy = [];

    if (!config.plotly.data.price.enabled && !config.plotly.data.volume.enabled)
        this.processStratCandles = null;
    if (!config.plotly.data.trades.enabled) this.processTradeCompleted = null;
    if (!config.plotly.data.strategy.enabled) this.processStratUpdate = null;

    _.bindAll(this);
};

Plotly.prototype.processStratCandle = function(candle) {
    let strippedCandle;

    strippedCandle = {
        ...candle,
        start: candle.start.unix()
    };

    this.candles.push(strippedCandle);
};

Plotly.prototype.processTradeCompleted = function(trade) {
    this.trades.push({
        ...trade,
        date: trade.date.unix()
    });
};

Plotly.prototype.processStratUpdate = function(stratUpdate) {
    this.strategy.push({
        ...stratUpdate
    });
};

Plotly.prototype.finalize = function(done) {
    const data = {};

    data.stats = {};
    data.chart = [];

    data.layout = {
        title: `${config.tradingAdvisor.method} : ${
            config.backtest.daterange.from
        } to ${config.backtest.daterange.to}`,
        autosize: config.plotly.layout.autosize,
        height: config.plotly.layout.height,
        width: config.plotly.layout.width,
        legend: {
            orientation: config.plotly.layout.legendOrientation,
            bgcolor: "rgba(0,0,0,0)"
        },
        xaxis: {
            autorange: true,
            rangeselector: {},
            type: "date"
        },
        yaxis: {
            title: `${config.watch.asset}/${config.watch.currency} ${
                config.watch.exchange
            }`,
            autorange: true,
            type: "linear"
        },
        ...config.plotly.layout.additional
    };

    data.stats.date = plotlyDates(propList("start", this.candles));

    if (config.plotly.data.price.enabled) {
        data.stats.price = R.zipWith(
            (a, b) => (a + b) / 2,
            propList("open", this.candles),
            propList("close", this.candles)
        );
        data.chart.push({
            name: "Price",
            type: "scattergl",
            mode: "line",
            x: data.stats.date,
            y: data.stats.price,
            xaxis: "x",
            yaxis: "y",
            opacity: config.plotly.data.price.opacity,
            line: {
                color: config.plotly.data.price.color,
                width: config.plotly.data.price.width
            }
        });
    }

    if (config.plotly.data.trades.enabled) {
        data.stats.trade = {
            buy: {
                date: plotlyDates(
                    propListWhere("date", "action", "buy", this.trades)
                ),
                price: propListWhere("price", "action", "buy", this.trades)
            },
            sell: {
                date: plotlyDates(
                    propListWhere("date", "action", "sell", this.trades)
                ),
                price: propListWhere("price", "action", "sell", this.trades)
            }
        };
        data.chart.push(
            {
                name: "Buy",
                type: "scattergl",
                mode: "markers",
                x: data.stats.trade.buy.date,
                y: data.stats.trade.buy.price,
                marker: {
                    color: config.plotly.data.trades.buy.color,
                    opacity: config.plotly.data.trades.buy.opacity,
                    size: config.plotly.data.trades.buy.size
                }
            },
            {
                name: "Sell",
                type: "scattergl",
                mode: "markers",
                x: data.stats.trade.sell.date,
                y: data.stats.trade.sell.price,
                marker: {
                    color: config.plotly.data.trades.sell.color,
                    opacity: config.plotly.data.trades.sell.opacity,
                    size: config.plotly.data.trades.sell.size
                }
            }
        );
    }

    if (config.plotly.data.volume.enabled) {
        data.stats.volume = propList("volume", this.candles);
        data.chart.push({
            name: "Volume",
            type: "scattergl",
            mode: "line",
            x: data.stats.date,
            y: data.stats.volume,
            xaxis: "x",
            yaxis: "y2",
            opacity: config.plotly.data.volume.color,
            line: {
                color: config.plotly.data.volume.color,
                width: config.plotly.data.volume.width
            }
        });
        data.layout.yaxis2 = {
            title: "Volume",
            autorange: true,
            type: "linear",
            side: "right",
            overlaying: "y"
        };
    }

    if (config.plotly.data.strategy.enabled) {
        data.stats.indicators = R.map(
            x => propPathList(x["path"], propList("indicators", this.strategy)),
            config.plotly.data.strategy.indicators
        );
        Object.keys(data.stats.indicators).forEach((x, i) => {
            const iconf = config.plotly.data.strategy.indicators[x];
            const iyaxis = iconf.yaxis + 3;
            data.chart.push({
                name: x.toString(),
                type: "scattergl",
                mode: "line",
                x: data.stats.date,
                y: data.stats.indicators[x],
                xaxis: "x",
                yaxis: `y${iyaxis}`,
                opacity: iconf.opacity,
                line: {
                    color: iconf.color,
                    width: iconf.width
                }
            });
            data.layout[`yaxis${iyaxis}`] = {
                hiddenTitle: x.toString(),
                autorange: true,
                type: "linear",
                side: "right",
                overlaying: "y",
                showticklabels: false
            };
        });
    }

    data.layout.xaxis.rangeselector.buttons = R.concat(
        R.map(
            ([n, s]) => {
                return {
                    count: n,
                    label: n + R.head(s),
                    step: s,
                    stepmode: "backward"
                };
            },
            R.compose(
                R.unnest,
                R.values
            )(
                R.mapObjIndexed((value, key, obj) => {
                    return R.map(value => [value, key], value);
                }, config.plotly.layout.buttons)
            )
        ),
        [{ step: "all" }]
    );

    data.config = {
        responsive: true
    };

    if (config.plotly.write.enabled) {
        const plotHtml = `<!DOCTYPE html>
<html lang="en">
        <head>
            <meta charset="UTF-8">
            <title>${config.tradingAdvisor.method} Plot</title>
            <script type="text/javascript" src="https://cdn.plot.ly/plotly-latest.min.js"></script>
        </head>
        <body>
            <div id="chart"></div>
            <script type="text/javascript">
                const data = ${jstr(data)};
                Plotly.newPlot("chart", data.chart, data.layout, data.config);
            </script>
        </body>
</html>`;
        const writePath = path.join(
            util.dirs().gekko,
            config.plotly.write.path,
            "plot.html"
        );

        fs.writeFile(writePath, plotHtml, err => {
            if (err) {
                log.error("unable to write plot.html", err);
            } else {
                log.info("written plot.html to: ", writePath);
            }

            done();
        });
    } else {
        done();
    }
};

module.exports = Plotly;

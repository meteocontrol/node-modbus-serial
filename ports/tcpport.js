'use strict';
var util = require('util');
var events = require('events');
var EventEmitter = events.EventEmitter || events;
var net = require('net');

var crc16 = require('./../utils/crc16');

var MODBUS_PORT = 502; // modbus port
var MAX_TRANSACTIONS = 64; // maximum transaction to wait for

/**
 * Simulate a modbus-RTU port using modbus-TCP connection
 */
var TcpPort = function(ip, options) {
    var modbus = this;
    this.ip = ip;
    this.openFlag = false;
    this.callback = null;
    this.expectedLength = {};
    this.bufferedData = new Buffer(0);
    this._transactionId = 0;

    // options
    if (typeof(options) == 'undefined') options = {};
    this.port = options.port || MODBUS_PORT; // modbus port

    // handle callback - call a callback function only once, for the first event
    // it will trigger
    var handleCallback = function(had_error) {
        if (modbus.callback) {
            modbus.callback(had_error);
            modbus.callback = null;
        }
    };

    // create a socket
    this._client = new net.Socket();
    this._client.on('data', function(data) {
      try {
        modbus.processData(data);
      } catch (err) {
        // if any error happens destroy the socket and close this port
        modbus._client.destroy();
        modbus.openFlag = false;
        // make sure this socket is not reused as a new instance of port must be created
        modbus._client = null;
      }
    });

    this._client.on('connect', function() {
        modbus.openFlag = true;
        handleCallback();
    });

    this._client.on('close', function(had_error) {
        modbus.openFlag = false;
        handleCallback(had_error);
    });

    this._client.on('error', function(had_error) {
        modbus.openFlag = false;
        handleCallback(had_error);
    });

    EventEmitter.call(this);
};
util.inherits(TcpPort, EventEmitter);

/**
 * Simulate successful port open
 */
TcpPort.prototype.processData = function (data) {

    // always buffer
    this.bufferedData = Buffer.concat([this.bufferedData, data]);

    // check data length
    if (this.bufferedData.length < 6 + 3) return;

    var expectedLength = 0;

    if (this.bufferedData.readUInt8(7) > 0x80) {
        // it's a modbus exception
        expectedLength = 9
    } else {
        var transactionId = this.bufferedData.readUInt16BE(0);
        expectedLength = this.expectedLength[transactionId] + 6;
    }

    if (this.bufferedData.length < expectedLength) return;

    var buffer;
    var crc;

    // cut 6 bytes of mbap, copy pdu and add crc
    buffer = new Buffer(expectedLength - 6 + 2);
    this.bufferedData.copy(buffer, 0, 6);
    crc = crc16(buffer.slice(0, -2));
    buffer.writeUInt16LE(crc, buffer.length - 2);

    // update transaction id
    this._transactionId = this.bufferedData.readUInt16BE(0);

    // remove handled message from buffer
    this.bufferedData = this.bufferedData.slice(expectedLength);

    // emit a data signal
    this.emit('data', buffer);

};

/**
 * Simulate successful port open
 */
TcpPort.prototype.open = function (callback) {
    this.callback = callback;
    this._client.connect(this.port, this.ip);
};

/**
 * Simulate successful close port
 */
TcpPort.prototype.close = function (callback) {
    if(this.openFlag === false) {
        callback();
        return;
    }
    
    this.callback = callback;
    this._client.end();
};

/**
 * Check if port is open
 */
TcpPort.prototype.isOpen = function() {
    return this.openFlag;
};

/**
 * Send data to a modbus-tcp slave
 */
TcpPort.prototype.write = function (data) {
    // get next transaction id
    var transactionsId = (this._transactionId + 1) % MAX_TRANSACTIONS;
    this.expectedLength[transactionsId] = 3 + data.readUInt16BE(4) * 2;

    // remove crc and add mbap
    var buffer = new Buffer(data.length + 6 - 2);
    buffer.writeUInt16BE(transactionsId, 0);
    buffer.writeUInt16BE(0, 2);
    buffer.writeUInt16BE(data.length - 2, 4);
    data.copy(buffer, 6);

    // send buffer to slave
    this._client.write(buffer);
};

module.exports = TcpPort;

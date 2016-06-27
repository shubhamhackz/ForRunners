'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.addEndian = addEndian;
exports.readRecord = readRecord;
exports.getArrayBuffer = getArrayBuffer;
exports.calculateCRC = calculateCRC;

var _fit = require('./fit');

var _messages = require('./messages');

function addEndian(littleEndian, bytes) {
  var result = 0;
  if (!littleEndian) bytes.reverse();
  for (var i = 0; i < bytes.length; i++) {
    result += bytes[i] << (i << 3) >>> 0;
  }

  return result;
}

function readData(blob, fDef, startIndex) {
  if (fDef.endianAbility === true) {
    var temp = [];
    for (var i = 0; i < fDef.size; i++) {
      temp.push(blob[startIndex + i]);
    }
    var uint32Rep = addEndian(fDef.littleEndian, temp);

    if (fDef.dataType === 'sint32') {
      return uint32Rep >> 0;
    }

    return uint32Rep;
  }
  return blob[startIndex];
}

function formatByType(data, type, scale, offset) {
  switch (type) {
    case 'date_time':
      return new Date(data * 1000 + 631062000000);
    case 'sint32':
    case 'sint16':
      return data * _fit.FIT.scConst;
    case 'uint32':
    case 'uint16':
      return scale ? data / scale + offset : data;
    default:
      if (_fit.FIT.types[type]) {
        return _fit.FIT.types[type][data];
      }
      return data;
  }
}

function convertTo(data, unitsList, speedUnit) {
  var unitObj = _fit.FIT.options[unitsList][speedUnit];
  return unitObj ? data * unitObj.multiplier + unitObj.offset : data;
}

function applyOptions(data, field, options) {
  switch (field) {
    case 'speed':
    case 'enhanced_speed':
    case 'vertical_speed':
    case 'avg_speed':
    case 'max_speed':
    case 'speed_1s':
    case 'ball_speed':
    case 'enhanced_avg_speed':
    case 'enhanced_max_speed':
    case 'avg_pos_vertical_speed':
    case 'max_pos_vertical_speed':
    case 'avg_neg_vertical_speed':
    case 'max_neg_vertical_speed':
      return convertTo(data, 'speedUnits', options.speedUnit);
    case 'distance':
    case 'total_distance':
    case 'enhanced_avg_altitude':
    case 'enhanced_min_altitude':
    case 'enhanced_max_altitude':
    case 'enhanced_altitude':
    case 'height':
    case 'odometer':
    case 'avg_stroke_distance':
    case 'min_altitude':
    case 'avg_altitude':
    case 'max_altitude':
    case 'total_ascent':
    case 'total_descent':
    case 'altitude':
    case 'cycle_length':
    case 'auto_wheelsize':
    case 'custom_wheelsize':
    case 'gps_accuracy':
      return convertTo(data, 'lengthUnits', options.lengthUnit);
    case 'temperature':
    case 'avg_temperature':
    case 'max_temperature':
      return convertTo(data, 'temperatureUnits', options.temperatureUnit);
    default:
      return data;
  }
}

function readRecord(blob, messageTypes, startIndex, options, startDate) {
  var recordHeader = blob[startIndex];
  var localMessageType = recordHeader & 15;

  if ((recordHeader & 64) === 64) {
    // is definition message
    // startIndex + 1 is reserved

    var lEnd = blob[startIndex + 2] === 0;
    var mTypeDef = {
      littleEndian: lEnd,
      globalMessageNumber: addEndian(lEnd, [blob[startIndex + 3], blob[startIndex + 4]]),
      numberOfFields: blob[startIndex + 5],
      fieldDefs: []
    };

    var _message = (0, _messages.getFitMessage)(mTypeDef.globalMessageNumber);

    for (var i = 0; i < mTypeDef.numberOfFields; i++) {
      var fDefIndex = startIndex + 6 + i * 3;
      var baseType = blob[fDefIndex + 2];

      var _message$getAttribute = _message.getAttributes(blob[fDefIndex]);

      var field = _message$getAttribute.field;
      var type = _message$getAttribute.type;

      var fDef = {
        type: type,
        fDefNo: blob[fDefIndex],
        size: blob[fDefIndex + 1],
        endianAbility: (baseType & 128) === 128,
        littleEndian: lEnd,
        baseTypeNo: baseType & 15,
        name: field,
        dataType: (0, _messages.getFitMessageBaseType)(baseType & 15)
      };

      mTypeDef.fieldDefs.push(fDef);
    }
    messageTypes[localMessageType] = mTypeDef;

    return {
      messageType: 'fieldDescription',
      nextIndex: startIndex + 6 + mTypeDef.numberOfFields * 3
    };
  }

  var messageType = void 0;

  if (messageTypes[localMessageType]) {
    messageType = messageTypes[localMessageType];
  } else {
    messageType = messageTypes[0];
  }

  // TODO: handle compressed header ((recordHeader & 128) == 128)

  // uncompressed header
  var messageSize = 0;
  var readDataFromIndex = startIndex + 1;
  var fields = {};
  var message = (0, _messages.getFitMessage)(messageType.globalMessageNumber);

  for (var _i = 0; _i < messageType.fieldDefs.length; _i++) {
    var _fDef = messageType.fieldDefs[_i];
    var data = readData(blob, _fDef, readDataFromIndex);

    var _message$getAttribute2 = message.getAttributes(_fDef.fDefNo);

    var field = _message$getAttribute2.field;
    var type = _message$getAttribute2.type;
    var scale = _message$getAttribute2.scale;
    var offset = _message$getAttribute2.offset;

    if (field !== 'unknown' && field !== '' && field !== undefined) {
      fields[field] = applyOptions(formatByType(data, type, scale, offset), field, options);
    }

    if (message.name === 'record' && options.elapsedRecordField) {
      fields.elapsed_time = (fields.timestamp - startDate) / 1000;
    }
    readDataFromIndex += _fDef.size;
    messageSize += _fDef.size;
  }

  var result = {
    messageType: message.name,
    nextIndex: startIndex + messageSize + 1,
    message: fields
  };

  return result;
}

function getArrayBuffer(buffer) {
  var ab = new ArrayBuffer(buffer.length);
  var view = new Uint8Array(ab);
  for (var i = 0; i < buffer.length; ++i) {
    view[i] = buffer[i];
  }
  return ab;
}

function calculateCRC(blob, start, end) {
  var crcTable = [0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401, 0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400];

  var crc = 0;
  for (var i = start; i < end; i++) {
    var byte = blob[i];
    var tmp = crcTable[crc & 0xF];
    crc = crc >> 4 & 0x0FFF;
    crc = crc ^ tmp ^ crcTable[byte & 0xF];
    tmp = crcTable[crc & 0xF];
    crc = crc >> 4 & 0x0FFF;
    crc = crc ^ tmp ^ crcTable[byte >> 4 & 0xF];
  }

  return crc;
}
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _binary = require('./binary');

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

var EasyFit = function () {
  function EasyFit() {
    var options = arguments.length <= 0 || arguments[0] === undefined ? {} : arguments[0];

    _classCallCheck(this, EasyFit);

    this.options = {
      force: options.force || true,
      speedUnit: options.speedUnit || 'm/s',
      lengthUnit: options.lengthUnit || 'm',
      temperatureUnit: options.temperatureUnit || 'celsius',
      elapsedRecordField: options.elapsedRecordField || false,
      mode: options.mode || 'list'
    };
  }

  _createClass(EasyFit, [{
    key: 'parse',
    value: function parse(content, callback) {
      var blob = new Uint8Array((0, _binary.getArrayBuffer)(content));

      if (blob.length < 12) {
        callback('File to small to be a FIT file', {});
        if (!this.options.force) {
          return;
        }
      }

      var headerLength = blob[0];
      if (headerLength !== 14 && headerLength !== 12) {
        callback('Incorrect header size', {});
        if (!this.options.force) {
          return;
        }
      }

      var fileTypeString = '';
      for (var i = 8; i < 12; i++) {
        fileTypeString += String.fromCharCode(blob[i]);
      }
      if (fileTypeString !== '.FIT') {
        callback('Missing \'.FIT\' in header', {});
        if (!this.options.force) {
          return;
        }
      }

      if (headerLength === 14) {
        var crcHeader = blob[12] + (blob[13] << 8);
        var crcHeaderCalc = (0, _binary.calculateCRC)(blob, 0, 12);
        if (crcHeader !== crcHeaderCalc) {
          // callback('Header CRC mismatch', {});
          // TODO: fix Header CRC check
          if (!this.options.force) {
            return;
          }
        }
      }
      var dataLength = blob[4] + (blob[5] << 8) + (blob[6] << 16) + (blob[7] << 24);
      var crcStart = dataLength + headerLength;
      var crcFile = blob[crcStart] + (blob[crcStart + 1] << 8);
      var crcFileCalc = (0, _binary.calculateCRC)(blob, headerLength === 12 ? 0 : headerLength, crcStart);

      if (crcFile !== crcFileCalc) {
        // callback('File CRC mismatch', {});
        // TODO: fix File CRC check
        if (!this.options.force) {
          return;
        }
      }

      var fitObj = {};
      var sessions = [];
      var laps = [];
      var records = [];
      var events = [];

      var tempLaps = [];
      var tempRecords = [];

      var loopIndex = headerLength;
      var messageTypes = [];

      var isModeCascade = this.options.mode === 'cascade';
      var isCascadeNeeded = isModeCascade || this.options.mode === 'both';

      var startDate = void 0;

      while (loopIndex < crcStart) {
        var _readRecord = (0, _binary.readRecord)(blob, messageTypes, loopIndex, this.options, startDate);

        var nextIndex = _readRecord.nextIndex;
        var messageType = _readRecord.messageType;
        var message = _readRecord.message;

        loopIndex = nextIndex;
        switch (messageType) {
          case 'lap':
            if (isCascadeNeeded) {
              message.records = tempRecords;
              tempRecords = [];
              tempLaps.push(message);
            }
            laps.push(message);
            break;
          case 'session':
            if (isCascadeNeeded) {
              message.laps = tempLaps;
              tempLaps = [];
            }
            sessions.push(message);
            break;
          case 'event':
            events.push(message);
            break;
          case 'record':
            if (!startDate) {
              startDate = message.timestamp;
              message.elapsed_time = 0;
            }
            records.push(message);
            if (isCascadeNeeded) {
              tempRecords.push(message);
            }
            break;
          default:
            if (messageType !== '') {
              fitObj[messageType] = message;
            }
            break;
        }
      }

      if (isCascadeNeeded) {
        fitObj.activity.sessions = sessions;
        fitObj.activity.events = events;
      }
      if (!isModeCascade) {
        fitObj.sessions = sessions;
        fitObj.laps = laps;
        fitObj.records = records;
        fitObj.events = events;
      }

      callback(null, fitObj);
    }
  }]);

  return EasyFit;
}();

exports.default = EasyFit;
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getMessageName = getMessageName;
exports.getFieldObject = getFieldObject;
var FIT = exports.FIT = {
  scConst: 180 / Math.pow(2, 31),
  options: {
    speedUnits: {
      mph: {
        multiplier: 3.6 / 1.4,
        offset: 0
      },
      'km/h': {
        multiplier: 3.6,
        offset: 0
      }
    },
    lengthUnits: {
      mi: {
        multiplier: 1 / 1400,
        offset: 0
      },
      km: {
        multiplier: 1 / 1000,
        offset: 0
      }
    },
    temperatureUnits: {
      kelvin: {
        multiplier: 1,
        offset: -273.15
      },
      fahrenheit: {
        multiplier: 1,
        offset: 0
      }
    }
  },
  messages: {
    0: {
      name: 'file_id',
      0: { field: 'type', type: 'file', scale: null, offset: '', units: '' },
      1: { field: 'manufacturer', type: 'manufacturer', scale: null, offset: '', units: '' },
      2: { field: 'product', type: 'uint16', scale: null, offset: '', units: '' },
      3: { field: 'serial_number', type: 'uint32z', scale: null, offset: '', units: '' },
      4: { field: 'time_created', type: 'date_time', scale: null, offset: '', units: '' },
      5: { field: 'number', type: 'uint16', scale: null, offset: '', units: '' },
      8: { field: 'product_name', type: 'string', scale: null, offset: '', units: '' }
    },
    1: {
      name: 'capabilities',
      0: { field: 'languages', type: 'uint8z', scale: null, offset: '', units: '' },
      1: { field: 'sports', type: 'sport_bits_0', scale: null, offset: '', units: '' },
      21: { field: 'workouts_supported', type: 'workout_capabilities', scale: null, offset: '', units: '' },
      23: { field: 'connectivity_supported', type: 'connectivity_capabilities', scale: null, offset: '', units: '' }
    },
    2: {
      name: 'device_settings',
      0: { field: 'active_time_zone', type: 'uint8', scale: null, offset: '', units: '' },
      1: { field: 'utc_offset', type: 'uint32', scale: null, offset: '', units: '' },
      2: { field: 'time_offset', type: 'uint32', scale: null, offset: '', units: 's' },
      5: { field: 'time_zone_offset', type: 'sint8', scale: 4, offset: '', units: 'hr' },
      55: { field: 'display_orientation', type: 'display_orientation', scale: null, offset: '', units: '' },
      56: { field: 'mounting_side', type: 'side', scale: null, offset: '', units: '' },
      94: { field: 'number_of_screens', type: 'uint8', scale: null, offset: '', units: '' },
      95: { field: 'smart_notification_display_orientation', type: 'display_orientation', scale: null, offset: '', units: '' }
    },
    3: {
      name: 'user_profile',
      254: { field: 'message_index', type: 'message_index', scale: null, offset: 0, units: '' },
      0: { field: 'friendly_name', type: 'string', scale: null, offset: 0, units: '' },
      1: { field: 'gender', type: 'gender', scale: null, offset: 0, units: '' },
      2: { field: 'age', type: 'uint8', scale: null, offset: 0, units: 'years' },
      3: { field: 'height', type: 'uint8', scale: 100, offset: 0, units: 'm' },
      4: { field: 'weight', type: 'uint16', scale: 10, offset: 0, units: 'kg' },
      5: { field: 'language', type: 'language', scale: null, offset: 0, units: '' },
      6: { field: 'elev_setting', type: 'display_measure', scale: null, offset: 0, units: '' },
      7: { field: 'weight_setting', type: 'display_measure', scale: null, offset: 0, units: '' },
      8: { field: 'resting_heart_rate', type: 'uint8', scale: null, offset: 0, units: 'bpm' },
      9: { field: 'default_max_running_heart_rate', type: 'uint8', scale: null, offset: 0, units: 'bpm' },
      10: { field: 'default_max_biking_heart_rate', type: 'uint8', scale: null, offset: 0, units: 'bpm' },
      11: { field: 'default_max_heart_rate', type: 'uint8', scale: null, offset: 0, units: 'bpm' },
      12: { field: 'hr_setting', type: 'display_heart', scale: null, offset: 0, units: '' },
      13: { field: 'speed_setting', type: 'display_measure', scale: null, offset: 0, units: '' },
      14: { field: 'dist_setting', type: 'display_measure', scale: null, offset: 0, units: '' },
      16: { field: 'power_setting', type: 'display_power', scale: null, offset: 0, units: '' },
      17: { field: 'activity_class', type: 'activity_class', scale: null, offset: 0, units: '' },
      18: { field: 'position_setting', type: 'display_position', scale: null, offset: 0, units: '' },
      21: { field: 'temperature_setting', type: 'display_measure', scale: null, offset: 0, units: '' },
      22: { field: 'local_id', type: 'user_local_id', scale: null, offset: 0, units: '' },
      23: { field: 'global_id', type: 'byte', scale: null, offset: 0, units: '' },
      30: { field: 'height_setting', type: 'display_measure', scale: null, offset: 0, units: '' }
    },
    4: {
      name: 'hrm_profile',
      254: { field: 'message_index', type: 'message_index', scale: null, offset: '', units: '' },
      0: { field: 'enabled', type: 'bool', scale: null, offset: '', units: '' },
      1: { field: 'hrm_ant_id', type: 'uint16z', scale: null, offset: '', units: '' },
      2: { field: 'log_hrv', type: 'bool', scale: null, offset: '', units: '' },
      3: { field: 'hrm_ant_id_trans_type', type: 'uint8z', scale: null, offset: '', units: '' }
    },
    5: {
      name: 'sdm_profile',
      254: { field: 'message_index', type: 'message_index', scale: null, offset: '', units: '' },
      0: { field: 'enabled', type: 'bool', scale: null, offset: '', units: '' },
      1: { field: 'sdm_ant_id', type: 'uint16z', scale: null, offset: '', units: '' },
      2: { field: 'sdm_cal_factor', type: 'uint16', scale: 10, offset: '', units: '%' },
      3: { field: 'odometer', type: 'uint32', scale: 100, offset: '', units: 'm' },
      4: { field: 'speed_source', type: 'bool', scale: null, offset: '', units: '' },
      5: { field: 'sdm_ant_id_trans_type', type: 'uint8z', scale: null, offset: '', units: '' },
      7: { field: 'odometer_rollover', type: 'uint8', scale: null, offset: '', units: '' }
    },
    6: {
      name: 'bike_profile',
      254: { field: 'message_index', type: 'message_index', scale: null, offset: 0, units: '' },
      0: { field: 'name', type: 'string', scale: null, offset: 0, units: '' },
      1: { field: 'sport', type: 'sport', scale: null, offset: 0, units: '' },
      2: { field: 'sub_sport', type: 'sub_sport', scale: null, offset: 0, units: '' },
      3: { field: 'odometer', type: 'uint32', scale: 100, offset: 0, units: 'm' },
      4: { field: 'bike_spd_ant_id', type: 'uint16z', scale: null, offset: 0, units: '' },
      5: { field: 'bike_cad_ant_id', type: 'uint16z', scale: null, offset: 0, units: '' },
      6: { field: 'bike_spdcad_ant_id', type: 'uint16z', scale: null, offset: 0, units: '' },
      7: { field: 'bike_power_ant_id', type: 'uint16z', scale: null, offset: 0, units: '' },
      8: { field: 'custom_wheelsize', type: 'uint16', scale: 1000, offset: 0, units: 'm' },
      9: { field: 'auto_wheelsize', type: 'uint16', scale: 1000, offset: 0, units: 'm' },
      10: { field: 'bike_weight', type: 'uint16', scale: 10, offset: 0, units: 'kg' },
      11: { field: 'power_cal_factor', type: 'uint16', scale: 10, offset: 0, units: '%' },
      12: { field: 'auto_wheel_cal', type: 'bool', scale: null, offset: 0, units: '' },
      13: { field: 'auto_power_zero', type: 'bool', scale: null, offset: 0, units: '' },
      14: { field: 'id', type: 'uint8', scale: null, offset: 0, units: '' },
      15: { field: 'spd_enabled', type: 'bool', scale: null, offset: 0, units: '' },
      16: { field: 'cad_enabled', type: 'bool', scale: null, offset: 0, units: '' },
      17: { field: 'spdcad_enabled', type: 'bool', scale: null, offset: 0, units: '' },
      18: { field: 'power_enabled', type: 'bool', scale: null, offset: 0, units: '' },
      19: { field: 'crank_length', type: 'uint8', scale: 2, offset: -110, units: 'mm' },
      20: { field: 'enabled', type: 'bool', scale: null, offset: 0, units: '' },
      21: { field: 'bike_spd_ant_id_trans_type', type: 'uint8z', scale: null, offset: 0, units: '' },
      22: { field: 'bike_cad_ant_id_trans_type', type: 'uint8z', scale: null, offset: 0, units: '' },
      23: { field: 'bike_spdcad_ant_id_trans_type', type: 'uint8z', scale: null, offset: 0, units: '' },
      24: { field: 'bike_power_ant_id_trans_type', type: 'uint8z', scale: null, offset: 0, units: '' },
      37: { field: 'odometer_rollover', type: 'uint8', scale: null, offset: 0, units: '' },
      38: { field: 'front_gear_num', type: 'uint8z', scale: null, offset: 0, units: '' },
      39: { field: 'front_gear', type: 'uint8z', scale: null, offset: 0, units: '' },
      40: { field: 'rear_gear_num', type: 'uint8z', scale: null, offset: 0, units: '' },
      41: { field: 'rear_gear', type: 'uint8z', scale: null, offset: 0, units: '' },
      44: { field: 'shimano_di2_enabled', type: 'bool', scale: null, offset: 0, units: '' }
    },
    7: {
      name: 'zones_target',
      1: { field: 'max_heart_rate', type: 'uint8', scale: null, offset: '', units: '' },
      2: { field: 'threshold_heart_rate', type: 'uint8', scale: null, offset: '', units: '' },
      3: { field: 'functional_threshold_power', type: 'uint16', scale: null, offset: '', units: '' },
      5: { field: 'hr_calc_type', type: 'hr_zone_calc', scale: null, offset: '', units: '' },
      7: { field: 'pwr_calc_type', type: 'pwr_zone_calc', scale: null, offset: '', units: '' }
    },
    8: {
      name: 'hr_zone',
      254: { field: 'message_index', type: 'message_index', scale: null, offset: 0, units: '' },
      1: { field: 'high_bpm', type: 'uint8', scale: null, offset: 0, units: 'bpm' },
      2: { field: 'name', type: 'string', scale: null, offset: 0, units: '' }
    },
    9: {
      name: 'power_zone',
      254: { field: 'message_index', type: 'message_index', scale: null, offset: 0, units: '' },
      1: { field: 'high_value', type: 'uint16', scale: null, offset: 0, units: 'watts' },
      2: { field: 'name', type: 'string', scale: null, offset: 0, units: '' }
    },
    10: {
      name: 'met_zone',
      254: { field: 'message_index', type: 'message_index', scale: null, offset: 0, units: '' },
      1: { field: 'high_bpm', type: 'uint8', scale: null, offset: 0, units: '' },
      2: { field: 'calories', type: 'uint16', scale: 10, offset: 0, units: 'kcal / min' },
      3: { field: 'fat_calories', type: 'uint8', scale: 10, offset: 0, units: 'kcal / min' }
    },
    12: {
      name: 'sport',
      0: { field: 'sport', type: 'sport', scale: null, offset: '', units: '' },
      1: { field: 'sub_sport', type: 'sub_sport', scale: null, offset: '', units: '' },
      3: { field: 'name', type: 'string', scale: null, offset: '', units: '' }
    },
    15: {
      name: 'goal',
      254: { field: 'message_index', type: 'message_index', scale: null, offset: '', units: '' },
      0: { field: 'sport', type: 'sport', scale: null, offset: '', units: '' },
      1: { field: 'sub_sport', type: 'sub_sport', scale: null, offset: '', units: '' },
      2: { field: 'start_date', type: 'date_time', scale: null, offset: '', units: '' },
      3: { field: 'end_date', type: 'date_time', scale: null, offset: '', units: '' },
      4: { field: 'type', type: 'goal', scale: null, offset: '', units: '' },
      5: { field: 'value', type: 'uint32', scale: null, offset: '', units: '' },
      6: { field: 'repeat', type: 'bool', scale: null, offset: '', units: '' },
      7: { field: 'target_value', type: 'uint32', scale: null, offset: '', units: '' },
      8: { field: 'recurrence', type: 'goal_recurrence', scale: null, offset: '', units: '' },
      9: { field: 'recurrence_value', type: 'uint16', scale: null, offset: '', units: '' },
      10: { field: 'enabled', type: 'bool', scale: null, offset: '', units: '' }
    },
    18: {
      name: 'session',
      254: { field: 'message_index', type: 'message_index', scale: null, offset: 0, units: '' },
      253: { field: 'timestamp', type: 'date_time', scale: null, offset: 0, units: 's' },
      0: { field: 'event', type: 'event', scale: null, offset: 0, units: '' },
      1: { field: 'event_type', type: 'event_type', scale: null, offset: 0, units: '' },
      2: { field: 'start_time', type: 'date_time', scale: null, offset: 0, units: '' },
      3: { field: 'start_position_lat', type: 'sint32', scale: null, offset: 0, units: 'semicircles' },
      4: { field: 'start_position_long', type: 'sint32', scale: null, offset: 0, units: 'semicircles' },
      5: { field: 'sport', type: 'sport', scale: null, offset: 0, units: '' },
      6: { field: 'sub_sport', type: 'sub_sport', scale: null, offset: 0, units: '' },
      7: { field: 'total_elapsed_time', type: 'uint32', scale: 1000, offset: 0, units: 's' },
      8: { field: 'total_timer_time', type: 'uint32', scale: 1000, offset: 0, units: 's' },
      9: { field: 'total_distance', type: 'uint32', scale: 100, offset: 0, units: 'm' },
      10: { field: 'total_cycles', type: 'uint32', scale: null, offset: 0, units: 'cycles' },
      11: { field: 'total_calories', type: 'uint16', scale: null, offset: 0, units: 'kcal' },
      13: { field: 'total_fat_calories', type: 'uint16', scale: null, offset: 0, units: 'kcal' },
      14: { field: 'avg_speed', type: 'uint16', scale: 1000, offset: 0, units: 'm/s' },
      15: { field: 'max_speed', type: 'uint16', scale: 1000, offset: 0, units: 'm/s' },
      16: { field: 'avg_heart_rate', type: 'uint8', scale: null, offset: 0, units: 'bpm' },
      17: { field: 'max_heart_rate', type: 'uint8', scale: null, offset: 0, units: 'bpm' },
      18: { field: 'avg_cadence', type: 'uint8', scale: null, offset: 0, units: 'rpm' },
      19: { field: 'max_cadence', type: 'uint8', scale: null, offset: 0, units: 'rpm' },
      20: { field: 'avg_power', type: 'uint16', scale: null, offset: 0, units: 'watts' },
      21: { field: 'max_power', type: 'uint16', scale: null, offset: 0, units: 'watts' },
      22: { field: 'total_ascent', type: 'uint16', scale: null, offset: 0, units: 'm' },
      23: { field: 'total_descent', type: 'uint16', scale: null, offset: 0, units: 'm' },
      24: { field: 'total_training_effect', type: 'uint8', scale: 10, offset: 0, units: '' },
      25: { field: 'first_lap_index', type: 'uint16', scale: null, offset: 0, units: '' },
      26: { field: 'num_laps', type: 'uint16', scale: null, offset: 0, units: '' },
      27: { field: 'event_group', type: 'uint8', scale: null, offset: 0, units: '' },
      28: { field: 'trigger', type: 'session_trigger', scale: null, offset: 0, units: '' },
      29: { field: 'nec_lat', type: 'sint32', scale: null, offset: 0, units: 'semicircles' },
      30: { field: 'nec_long', type: 'sint32', scale: null, offset: 0, units: 'semicircles' },
      31: { field: 'swc_lat', type: 'sint32', scale: null, offset: 0, units: 'semicircles' },
      32: { field: 'swc_long', type: 'sint32', scale: null, offset: 0, units: 'semicircles' },
      34: { field: 'normalized_power', type: 'uint16', scale: null, offset: 0, units: 'watts' },
      35: { field: 'training_stress_score', type: 'uint16', scale: 10, offset: 0, units: 'tss' },
      36: { field: 'intensity_factor', type: 'uint16', scale: 1000, offset: 0, units: 'if' },
      37: { field: 'left_right_balance', type: 'left_right_balance_100', scale: null, offset: 0, units: '' },
      41: { field: 'avg_stroke_count', type: 'uint32', scale: 10, offset: 0, units: 'strokes/lap' },
      42: { field: 'avg_stroke_distance', type: 'uint16', scale: 100, offset: 0, units: 'm' },
      43: { field: 'swim_stroke', type: 'swim_stroke', scale: null, offset: 0, units: 'swim_stroke' },
      44: { field: 'pool_length', type: 'uint16', scale: 100, offset: 0, units: 'm' },
      45: { field: 'threshold_power', type: 'uint16', scale: null, offset: 0, units: 'watts' },
      46: { field: 'pool_length_unit', type: 'display_measure', scale: null, offset: 0, units: '' },
      47: { field: 'num_active_lengths', type: 'uint16', scale: null, offset: 0, units: 'lengths' },
      48: { field: 'total_work', type: 'uint32', scale: null, offset: 0, units: 'J' },
      49: { field: 'avg_altitude', type: 'uint16', scale: 5, offset: 500, units: 'm' },
      50: { field: 'max_altitude', type: 'uint16', scale: 5, offset: 500, units: 'm' },
      51: { field: 'gps_accuracy', type: 'uint8', scale: null, offset: 0, units: 'm' },
      52: { field: 'avg_grade', type: 'sint16', scale: 100, offset: 0, units: '%' },
      53: { field: 'avg_pos_grade', type: 'sint16', scale: 100, offset: 0, units: '%' },
      54: { field: 'avg_neg_grade', type: 'sint16', scale: 100, offset: 0, units: '%' },
      55: { field: 'max_pos_grade', type: 'sint16', scale: 100, offset: 0, units: '%' },
      56: { field: 'max_neg_grade', type: 'sint16', scale: 100, offset: 0, units: '%' },
      57: { field: 'avg_temperature', type: 'sint8', scale: null, offset: 0, units: 'C' },
      58: { field: 'max_temperature', type: 'sint8', scale: null, offset: 0, units: 'C' },
      59: { field: 'total_moving_time', type: 'uint32', scale: 1000, offset: 0, units: 's' },
      60: { field: 'avg_pos_vertical_speed', type: 'sint16', scale: 1000, offset: 0, units: 'm/s' },
      61: { field: 'avg_neg_vertical_speed', type: 'sint16', scale: 1000, offset: 0, units: 'm/s' },
      62: { field: 'max_pos_vertical_speed', type: 'sint16', scale: 1000, offset: 0, units: 'm/s' },
      63: { field: 'max_neg_vertical_speed', type: 'sint16', scale: 1000, offset: 0, units: 'm/s' },
      64: { field: 'min_heart_rate', type: 'uint8', scale: null, offset: 0, units: 'bpm' },
      65: { field: 'time_in_hr_zone', type: 'uint32', scale: 1000, offset: 0, units: 's' },
      66: { field: 'time_in_speed_zone', type: 'uint32', scale: 1000, offset: 0, units: 's' },
      67: { field: 'time_in_cadence_zone', type: 'uint32', scale: 1000, offset: 0, units: 's' },
      68: { field: 'time_in_power_zone', type: 'uint32', scale: 1000, offset: 0, units: 's' },
      69: { field: 'avg_lap_time', type: 'uint32', scale: 1000, offset: 0, units: 's' },
      70: { field: 'best_lap_index', type: 'uint16', scale: null, offset: 0, units: '' },
      71: { field: 'min_altitude', type: 'uint16', scale: 5, offset: 500, units: 'm' },
      82: { field: 'player_score', type: 'uint16', scale: null, offset: 0, units: '' },
      83: { field: 'opponent_score', type: 'uint16', scale: null, offset: 0, units: '' },
      84: { field: 'opponent_name', type: 'string', scale: null, offset: 0, units: '' },
      85: { field: 'stroke_count', type: 'uint16', scale: null, offset: 0, units: 'counts' },
      86: { field: 'zone_count', type: 'uint16', scale: null, offset: 0, units: 'counts' },
      87: { field: 'max_ball_speed', type: 'uint16', scale: 100, offset: 0, units: 'm/s' },
      88: { field: 'avg_ball_speed', type: 'uint16', scale: 100, offset: 0, units: 'm/s' },
      89: { field: 'avg_vertical_oscillation', type: 'uint16', scale: 10, offset: 0, units: 'mm' },
      90: { field: 'avg_stance_time_percent', type: 'uint16', scale: 100, offset: 0, units: 'percent' },
      91: { field: 'avg_stance_time', type: 'uint16', scale: 10, offset: 0, units: 'ms' },
      92: { field: 'avg_fractional_cadence', type: 'uint8', scale: 128, offset: 0, units: 'rpm' },
      93: { field: 'max_fractional_cadence', type: 'uint8', scale: 128, offset: 0, units: 'rpm' },
      94: { field: 'total_fractional_cycles', type: 'uint8', scale: 128, offset: 0, units: 'cycles' },
      95: { field: 'avg_total_hemoglobin_conc', type: 'uint16', scale: 100, offset: 0, units: 'g/dL' },
      96: { field: 'min_total_hemoglobin_conc', type: 'uint16', scale: 100, offset: 0, units: 'g/dL' },
      97: { field: 'max_total_hemoglobin_conc', type: 'uint16', scale: 100, offset: 0, units: 'g/dL' },
      98: { field: 'avg_saturated_hemoglobin_percent', type: 'uint16', scale: 10, offset: 0, units: '%' },
      99: { field: 'min_saturated_hemoglobin_percent', type: 'uint16', scale: 10, offset: 0, units: '%' },
      100: { field: 'max_saturated_hemoglobin_percent', type: 'uint16', scale: 10, offset: 0, units: '%' },
      101: { field: 'avg_left_torque_effectiveness', type: 'uint8', scale: 2, offset: 0, units: 'percent' },
      102: { field: 'avg_right_torque_effectiveness', type: 'uint8', scale: 2, offset: 0, units: 'percent' },
      103: { field: 'avg_left_pedal_smoothness', type: 'uint8', scale: 2, offset: 0, units: 'percent' },
      104: { field: 'avg_right_pedal_smoothness', type: 'uint8', scale: 2, offset: 0, units: 'percent' },
      105: { field: 'avg_combined_pedal_smoothness', type: 'uint8', scale: 2, offset: 0, units: 'percent' },
      111: { field: 'sport_index', type: 'uint8', scale: null, offset: 0, units: '' },
      112: { field: 'time_standing', type: 'uint32', scale: 1000, offset: 0, units: 's' },
      113: { field: 'stand_count', type: 'uint16', scale: null, offset: 0, units: '' },
      114: { field: 'avg_left_pco', type: 'sint8', scale: null, offset: 0, units: 'mm' },
      115: { field: 'avg_right_pco', type: 'sint8', scale: null, offset: 0, units: 'mm' },
      116: { field: 'avg_left_power_phase', type: 'uint8', scale: '0,7111111', offset: 0, units: 'degrees' },
      117: { field: 'avg_left_power_phase_peak', type: 'uint8', scale: '0,7111111', offset: 0, units: 'degrees' },
      118: { field: 'avg_right_power_phase', type: 'uint8', scale: '0,7111111', offset: 0, units: 'degrees' },
      119: { field: 'avg_right_power_phase_peak', type: 'uint8', scale: '0,7111111', offset: 0, units: 'degrees' },
      120: { field: 'avg_power_position', type: 'uint16', scale: null, offset: 0, units: 'watts' },
      121: { field: 'max_power_position', type: 'uint16', scale: null, offset: 0, units: 'watts' },
      122: { field: 'avg_cadence_position', type: 'uint8', scale: null, offset: 0, units: 'rpm' },
      123: { field: 'max_cadence_position', type: 'uint8', scale: null, offset: 0, units: 'rpm' },
      124: { field: 'enhanced_avg_speed', type: 'uint32', scale: 1000, offset: 0, units: 'm/s' },
      125: { field: 'enhanced_max_speed', type: 'uint32', scale: 1000, offset: 0, units: 'm/s' },
      126: { field: 'enhanced_avg_altitude', type: 'uint32', scale: 5, offset: 500, units: 'm' },
      127: { field: 'enhanced_min_altitude', type: 'uint32', scale: 5, offset: 500, units: 'm' },
      128: { field: 'enhanced_max_altitude', type: 'uint32', scale: 5, offset: 500, units: 'm' },
      129: { field: 'avg_lev_motor_power', type: 'uint16', scale: null, offset: 0, units: 'watts' },
      130: { field: 'max_lev_motor_power', type: 'uint16', scale: null, offset: 0, units: 'watts' },
      131: { field: 'lev_battery_consumption', type: 'uint8', scale: 2, offset: 0, units: 'percent' }
    },
    19: {
      name: 'lap',
      254: { field: 'message_index', type: 'message_index', scale: null, offset: 0, units: '' },
      253: { field: 'timestamp', type: 'date_time', scale: null, offset: 0, units: 's' },
      0: { field: 'event', type: 'event', scale: null, offset: 0, units: '' },
      1: { field: 'event_type', type: 'event_type', scale: null, offset: 0, units: '' },
      2: { field: 'start_time', type: 'date_time', scale: null, offset: 0, units: '' },
      3: { field: 'start_position_lat', type: 'sint32', scale: null, offset: 0, units: 'semicircles' },
      4: { field: 'start_position_long', type: 'sint32', scale: null, offset: 0, units: 'semicircles' },
      5: { field: 'end_position_lat', type: 'sint32', scale: null, offset: 0, units: 'semicircles' },
      6: { field: 'end_position_long', type: 'sint32', scale: null, offset: 0, units: 'semicircles' },
      7: { field: 'total_elapsed_time', type: 'uint32', scale: 1000, offset: 0, units: 's' },
      8: { field: 'total_timer_time', type: 'uint32', scale: 1000, offset: 0, units: 's' },
      9: { field: 'total_distance', type: 'uint32', scale: 100, offset: 0, units: 'm' },
      10: { field: 'total_cycles', type: 'uint32', scale: null, offset: 0, units: 'cycles' },
      11: { field: 'total_calories', type: 'uint16', scale: null, offset: 0, units: 'kcal' },
      12: { field: 'total_fat_calories', type: 'uint16', scale: null, offset: 0, units: 'kcal' },
      13: { field: 'avg_speed', type: 'uint16', scale: 1000, offset: 0, units: 'm/s' },
      14: { field: 'max_speed', type: 'uint16', scale: 1000, offset: 0, units: 'm/s' },
      15: { field: 'avg_heart_rate', type: 'uint8', scale: null, offset: 0, units: 'bpm' },
      16: { field: 'max_heart_rate', type: 'uint8', scale: null, offset: 0, units: 'bpm' },
      17: { field: 'avg_cadence', type: 'uint8', scale: null, offset: 0, units: 'rpm' },
      18: { field: 'max_cadence', type: 'uint8', scale: null, offset: 0, units: 'rpm' },
      19: { field: 'avg_power', type: 'uint16', scale: null, offset: 0, units: 'watts' },
      20: { field: 'max_power', type: 'uint16', scale: null, offset: 0, units: 'watts' },
      21: { field: 'total_ascent', type: 'uint16', scale: null, offset: 0, units: 'm' },
      22: { field: 'total_descent', type: 'uint16', scale: null, offset: 0, units: 'm' },
      23: { field: 'intensity', type: 'intensity', scale: null, offset: 0, units: '' },
      24: { field: 'lap_trigger', type: 'lap_trigger', scale: null, offset: 0, units: '' },
      25: { field: 'sport', type: 'sport', scale: null, offset: 0, units: '' },
      26: { field: 'event_group', type: 'uint8', scale: null, offset: 0, units: '' },
      32: { field: 'num_lengths', type: 'uint16', scale: null, offset: 0, units: 'lengths' },
      33: { field: 'normalized_power', type: 'uint16', scale: null, offset: 0, units: 'watts' },
      34: { field: 'left_right_balance', type: 'left_right_balance_100', scale: null, offset: 0, units: '' },
      35: { field: 'first_length_index', type: 'uint16', scale: null, offset: 0, units: '' },
      37: { field: 'avg_stroke_distance', type: 'uint16', scale: 100, offset: 0, units: 'm' },
      38: { field: 'swim_stroke', type: 'swim_stroke', scale: null, offset: 0, units: '' },
      39: { field: 'sub_sport', type: 'sub_sport', scale: null, offset: 0, units: '' },
      40: { field: 'num_active_lengths', type: 'uint16', scale: null, offset: 0, units: 'lengths' },
      41: { field: 'total_work', type: 'uint32', scale: null, offset: 0, units: 'J' },
      42: { field: 'avg_altitude', type: 'uint16', scale: 5, offset: 500, units: 'm' },
      43: { field: 'max_altitude', type: 'uint16', scale: 5, offset: 500, units: 'm' },
      44: { field: 'gps_accuracy', type: 'uint8', scale: null, offset: 0, units: 'm' },
      45: { field: 'avg_grade', type: 'sint16', scale: 100, offset: 0, units: '%' },
      46: { field: 'avg_pos_grade', type: 'sint16', scale: 100, offset: 0, units: '%' },
      47: { field: 'avg_neg_grade', type: 'sint16', scale: 100, offset: 0, units: '%' },
      48: { field: 'max_pos_grade', type: 'sint16', scale: 100, offset: 0, units: '%' },
      49: { field: 'max_neg_grade', type: 'sint16', scale: 100, offset: 0, units: '%' },
      50: { field: 'avg_temperature', type: 'sint8', scale: null, offset: 0, units: 'C' },
      51: { field: 'max_temperature', type: 'sint8', scale: null, offset: 0, units: 'C' },
      52: { field: 'total_moving_time', type: 'uint32', scale: 1000, offset: 0, units: 's' },
      53: { field: 'avg_pos_vertical_speed', type: 'sint16', scale: 1000, offset: 0, units: 'm/s' },
      54: { field: 'avg_neg_vertical_speed', type: 'sint16', scale: 1000, offset: 0, units: 'm/s' },
      55: { field: 'max_pos_vertical_speed', type: 'sint16', scale: 1000, offset: 0, units: 'm/s' },
      56: { field: 'max_neg_vertical_speed', type: 'sint16', scale: 1000, offset: 0, units: 'm/s' },
      57: { field: 'time_in_hr_zone', type: 'uint32', scale: 1000, offset: 0, units: 's' },
      58: { field: 'time_in_speed_zone', type: 'uint32', scale: 1000, offset: 0, units: 's' },
      59: { field: 'time_in_cadence_zone', type: 'uint32', scale: 1000, offset: 0, units: 's' },
      60: { field: 'time_in_power_zone', type: 'uint32', scale: 1000, offset: 0, units: 's' },
      61: { field: 'repetition_num', type: 'uint16', scale: null, offset: 0, units: '' },
      62: { field: 'min_altitude', type: 'uint16', scale: 5, offset: 500, units: 'm' },
      63: { field: 'min_heart_rate', type: 'uint8', scale: null, offset: 0, units: 'bpm' },
      71: { field: 'wkt_step_index', type: 'message_index', scale: null, offset: 0, units: '' },
      74: { field: 'opponent_score', type: 'uint16', scale: null, offset: 0, units: '' },
      75: { field: 'stroke_count', type: 'uint16', scale: null, offset: 0, units: 'counts' },
      76: { field: 'zone_count', type: 'uint16', scale: null, offset: 0, units: 'counts' },
      77: { field: 'avg_vertical_oscillation', type: 'uint16', scale: 10, offset: 0, units: 'mm' },
      78: { field: 'avg_stance_time_percent', type: 'uint16', scale: 100, offset: 0, units: 'percent' },
      79: { field: 'avg_stance_time', type: 'uint16', scale: 10, offset: 0, units: 'ms' },
      80: { field: 'avg_fractional_cadence', type: 'uint8', scale: 128, offset: 0, units: 'rpm' },
      81: { field: 'max_fractional_cadence', type: 'uint8', scale: 128, offset: 0, units: 'rpm' },
      82: { field: 'total_fractional_cycles', type: 'uint8', scale: 128, offset: 0, units: 'cycles' },
      83: { field: 'player_score', type: 'uint16', scale: null, offset: 0, units: '' },
      84: { field: 'avg_total_hemoglobin_conc', type: 'uint16', scale: 100, offset: 0, units: 'g/dL' },
      85: { field: 'min_total_hemoglobin_conc', type: 'uint16', scale: 100, offset: 0, units: 'g/dL' },
      86: { field: 'max_total_hemoglobin_conc', type: 'uint16', scale: 100, offset: 0, units: 'g/dL' },
      87: { field: 'avg_saturated_hemoglobin_percent', type: 'uint16', scale: 10, offset: 0, units: '%' },
      88: { field: 'min_saturated_hemoglobin_percent', type: 'uint16', scale: 10, offset: 0, units: '%' },
      89: { field: 'max_saturated_hemoglobin_percent', type: 'uint16', scale: 10, offset: 0, units: '%' },
      91: { field: 'avg_left_torque_effectiveness', type: 'uint8', scale: 2, offset: 0, units: 'percent' },
      92: { field: 'avg_right_torque_effectiveness', type: 'uint8', scale: 2, offset: 0, units: 'percent' },
      93: { field: 'avg_left_pedal_smoothness', type: 'uint8', scale: 2, offset: 0, units: 'percent' },
      94: { field: 'avg_right_pedal_smoothness', type: 'uint8', scale: 2, offset: 0, units: 'percent' },
      95: { field: 'avg_combined_pedal_smoothness', type: 'uint8', scale: 2, offset: 0, units: 'percent' },
      98: { field: 'time_standing', type: 'uint32', scale: 1000, offset: 0, units: 's' },
      99: { field: 'stand_count', type: 'uint16', scale: null, offset: 0, units: '' },
      100: { field: 'avg_left_pco', type: 'sint8', scale: null, offset: 0, units: 'mm' },
      101: { field: 'avg_right_pco', type: 'sint8', scale: null, offset: 0, units: 'mm' },
      102: { field: 'avg_left_power_phase', type: 'uint8', scale: '0,7111111', offset: 0, units: 'degrees' },
      103: { field: 'avg_left_power_phase_peak', type: 'uint8', scale: '0,7111111', offset: 0, units: 'degrees' },
      104: { field: 'avg_right_power_phase', type: 'uint8', scale: '0,7111111', offset: 0, units: 'degrees' },
      105: { field: 'avg_right_power_phase_peak', type: 'uint8', scale: '0,7111111', offset: 0, units: 'degrees' },
      106: { field: 'avg_power_position', type: 'uint16', scale: null, offset: 0, units: 'watts' },
      107: { field: 'max_power_position', type: 'uint16', scale: null, offset: 0, units: 'watts' },
      108: { field: 'avg_cadence_position', type: 'uint8', scale: null, offset: 0, units: 'rpm' },
      109: { field: 'max_cadence_position', type: 'uint8', scale: null, offset: 0, units: 'rpm' },
      110: { field: 'enhanced_avg_speed', type: 'uint32', scale: 1000, offset: 0, units: 'm/s' },
      111: { field: 'enhanced_max_speed', type: 'uint32', scale: 1000, offset: 0, units: 'm/s' },
      112: { field: 'enhanced_avg_altitude', type: 'uint32', scale: 5, offset: 500, units: 'm' },
      113: { field: 'enhanced_min_altitude', type: 'uint32', scale: 5, offset: 500, units: 'm' },
      114: { field: 'enhanced_max_altitude', type: 'uint32', scale: 5, offset: 500, units: 'm' },
      115: { field: 'avg_lev_motor_power', type: 'uint16', scale: null, offset: 0, units: 'watts' },
      116: { field: 'max_lev_motor_power', type: 'uint16', scale: null, offset: 0, units: 'watts' },
      117: { field: 'lev_battery_consumption', type: 'uint8', scale: 2, offset: 0, units: 'percent' }
    },
    20: {
      name: 'record',
      253: { field: 'timestamp', type: 'date_time', scale: null, offset: 0, units: 's' },
      0: { field: 'position_lat', type: 'sint32', scale: null, offset: 0, units: 'semicircles' },
      1: { field: 'position_long', type: 'sint32', scale: null, offset: 0, units: 'semicircles' },
      2: { field: 'altitude', type: 'uint16', scale: 5, offset: 500, units: 'm' },
      3: { field: 'heart_rate', type: 'uint8', scale: null, offset: 0, units: 'bpm' },
      4: { field: 'cadence', type: 'uint8', scale: null, offset: 0, units: 'rpm' },
      5: { field: 'distance', type: 'uint32', scale: 100, offset: 0, units: 'm' },
      6: { field: 'speed', type: 'uint16', scale: 1000, offset: 0, units: 'm/s' },
      7: { field: 'power', type: 'uint16', scale: null, offset: 0, units: 'watts' },
      8: { field: 'compressed_speed_distance', type: 'byte', scale: '100,16', offset: 0, units: 'm/s,m' },
      9: { field: 'grade', type: 'sint16', scale: 100, offset: 0, units: '%' },
      10: { field: 'resistance', type: 'uint8', scale: null, offset: 0, units: '' },
      11: { field: 'time_from_course', type: 'sint32', scale: 1000, offset: 0, units: 's' },
      12: { field: 'cycle_length', type: 'uint8', scale: 100, offset: 0, units: 'm' },
      13: { field: 'temperature', type: 'sint8', scale: null, offset: 0, units: 'C' },
      17: { field: 'speed_1s', type: 'uint8', scale: 16, offset: 0, units: 'm/s' },
      18: { field: 'cycles', type: 'uint8', scale: null, offset: 0, units: 'cycles' },
      19: { field: 'total_cycles', type: 'uint32', scale: null, offset: 0, units: 'cycles' },
      28: { field: 'compressed_accumulated_power', type: 'uint16', scale: null, offset: 0, units: 'watts' },
      29: { field: 'accumulated_power', type: 'uint32', scale: null, offset: 0, units: 'watts' },
      30: { field: 'left_right_balance', type: 'left_right_balance', scale: null, offset: 0, units: '' },
      31: { field: 'gps_accuracy', type: 'uint8', scale: null, offset: 0, units: 'm' },
      32: { field: 'vertical_speed', type: 'sint16', scale: 1000, offset: 0, units: 'm/s' },
      33: { field: 'calories', type: 'uint16', scale: null, offset: 0, units: 'kcal' },
      39: { field: 'vertical_oscillation', type: 'uint16', scale: 10, offset: 0, units: 'mm' },
      40: { field: 'stance_time_percent', type: 'uint16', scale: 100, offset: 0, units: 'percent' },
      41: { field: 'stance_time', type: 'uint16', scale: 10, offset: 0, units: 'ms' },
      42: { field: 'activity_type', type: 'activity_type', scale: null, offset: 0, units: '' },
      43: { field: 'left_torque_effectiveness', type: 'uint8', scale: 2, offset: 0, units: 'percent' },
      44: { field: 'right_torque_effectiveness', type: 'uint8', scale: 2, offset: 0, units: 'percent' },
      45: { field: 'left_pedal_smoothness', type: 'uint8', scale: 2, offset: 0, units: 'percent' },
      46: { field: 'right_pedal_smoothness', type: 'uint8', scale: 2, offset: 0, units: 'percent' },
      47: { field: 'combined_pedal_smoothness', type: 'uint8', scale: 2, offset: 0, units: 'percent' },
      48: { field: 'time128', type: 'uint8', scale: 128, offset: 0, units: 's' },
      49: { field: 'stroke_type', type: 'stroke_type', scale: null, offset: 0, units: '' },
      50: { field: 'zone', type: 'uint8', scale: null, offset: 0, units: '' },
      51: { field: 'ball_speed', type: 'uint16', scale: 100, offset: 0, units: 'm/s' },
      52: { field: 'cadence256', type: 'uint16', scale: 256, offset: 0, units: 'rpm' },
      53: { field: 'fractional_cadence', type: 'uint8', scale: 128, offset: 0, units: 'rpm' },
      54: { field: 'total_hemoglobin_conc', type: 'uint16', scale: 100, offset: 0, units: 'g/dL' },
      55: { field: 'total_hemoglobin_conc_min', type: 'uint16', scale: 100, offset: 0, units: 'g/dL' },
      56: { field: 'total_hemoglobin_conc_max', type: 'uint16', scale: 100, offset: 0, units: 'g/dL' },
      57: { field: 'saturated_hemoglobin_percent', type: 'uint16', scale: 10, offset: 0, units: '%' },
      58: { field: 'saturated_hemoglobin_percent_min', type: 'uint16', scale: 10, offset: 0, units: '%' },
      59: { field: 'saturated_hemoglobin_percent_max', type: 'uint16', scale: 10, offset: 0, units: '%' },
      62: { field: 'device_index', type: 'device_index', scale: null, offset: 0, units: '' },
      67: { field: 'left_pco', type: 'sint8', scale: null, offset: 0, units: 'mm' },
      68: { field: 'right_pco', type: 'sint8', scale: null, offset: 0, units: 'mm' },
      69: { field: 'left_power_phase', type: 'uint8', scale: '0,7111111', offset: 0, units: 'degrees' },
      70: { field: 'left_power_phase_peak', type: 'uint8', scale: '0,7111111', offset: 0, units: 'degrees' },
      71: { field: 'right_power_phase', type: 'uint8', scale: '0,7111111', offset: 0, units: 'degrees' },
      72: { field: 'right_power_phase_peak', type: 'uint8', scale: '0,7111111', offset: 0, units: 'degrees' },
      73: { field: 'enhanced_speed', type: 'uint32', scale: 1000, offset: 0, units: 'm/s' },
      78: { field: 'enhanced_altitude', type: 'uint32', scale: 5, offset: 500, units: 'm' },
      81: { field: 'battery_soc', type: 'uint8', scale: 2, offset: 0, units: 'percent' },
      82: { field: 'motor_power', type: 'uint16', scale: null, offset: 0, units: 'watts' }
    },
    21: {
      name: 'event',
      253: { field: 'timestamp', type: 'date_time', scale: null, offset: '', units: 's' },
      0: { field: 'event', type: 'event', scale: null, offset: '', units: '' },
      1: { field: 'event_type', type: 'event_type', scale: null, offset: '', units: '' },
      2: { field: 'data16', type: 'uint16', scale: null, offset: '', units: '' },
      3: { field: 'data', type: 'uint32', scale: null, offset: '', units: '' },
      4: { field: 'event_group', type: 'uint8', scale: null, offset: '', units: '' },
      7: { field: 'score', type: 'uint16', scale: null, offset: '', units: '' },
      8: { field: 'opponent_score', type: 'uint16', scale: null, offset: '', units: '' },
      9: { field: 'front_gear_num', type: 'uint8z', scale: null, offset: '', units: '' },
      10: { field: 'front_gear', type: 'uint8z', scale: null, offset: '', units: '' },
      11: { field: 'rear_gear_num', type: 'uint8z', scale: null, offset: '', units: '' },
      12: { field: 'rear_gear', type: 'uint8z', scale: null, offset: '', units: '' },
      13: { field: 'device_index', type: 'device_index', scale: null, offset: '', units: '' }
    },
    23: {
      name: 'device_info',
      253: { field: 'timestamp', type: 'date_time', scale: null, offset: 0, units: 's' },
      0: { field: 'device_index', type: 'device_index', scale: null, offset: 0, units: '' },
      1: { field: 'device_type', type: 'uint8', scale: null, offset: 0, units: '' },
      2: { field: 'manufacturer', type: 'manufacturer', scale: null, offset: 0, units: '' },
      3: { field: 'serial_number', type: 'uint32z', scale: null, offset: 0, units: '' },
      4: { field: 'product', type: 'uint16', scale: null, offset: 0, units: '' },
      5: { field: 'software_version', type: 'uint16', scale: 100, offset: 0, units: '' },
      6: { field: 'hardware_version', type: 'uint8', scale: null, offset: 0, units: '' },
      7: { field: 'cum_operating_time', type: 'uint32', scale: null, offset: 0, units: 's' },
      10: { field: 'battery_voltage', type: 'uint16', scale: 256, offset: 0, units: 'V' },
      11: { field: 'battery_status', type: 'battery_status', scale: null, offset: 0, units: '' },
      18: { field: 'sensor_position', type: 'body_location', scale: null, offset: 0, units: '' },
      19: { field: 'descriptor', type: 'string', scale: null, offset: 0, units: '' },
      20: { field: 'ant_transmission_type', type: 'uint8z', scale: null, offset: 0, units: '' },
      21: { field: 'ant_device_number', type: 'uint16z', scale: null, offset: 0, units: '' },
      22: { field: 'ant_network', type: 'ant_network', scale: null, offset: 0, units: '' },
      25: { field: 'source_type', type: 'source_type', scale: null, offset: 0, units: '' },
      27: { field: 'product_name', type: 'string', scale: null, offset: 0, units: '' }
    },
    26: {
      name: 'workout',
      4: { field: 'sport', type: 'sport', scale: null, offset: '', units: '' },
      5: { field: 'capabilities', type: 'workout_capabilities', scale: null, offset: '', units: '' },
      6: { field: 'num_valid_steps', type: 'uint16', scale: null, offset: '', units: '' },
      8: { field: 'wkt_name', type: 'string', scale: null, offset: '', units: '' }
    },
    27: {
      name: 'workout_step',
      254: { field: 'message_index', type: 'message_index', scale: null, offset: 0, units: '' },
      0: { field: 'wkt_step_name', type: 'string', scale: null, offset: 0, units: '' },
      1: { field: 'duration_type', type: 'wkt_step_duration', scale: null, offset: 0, units: '' },
      2: { field: 'duration_value', type: 'uint32', scale: null, offset: 0, units: '' },
      3: { field: 'target_type', type: 'wkt_step_target', scale: null, offset: 0, units: '' },
      4: { field: 'target_value', type: 'uint32', scale: null, offset: 0, units: '' },
      5: { field: 'custom_target_value_low', type: 'uint32', scale: null, offset: 0, units: '' },
      6: { field: 'custom_target_value_high', type: 'uint32', scale: null, offset: 0, units: '' },
      7: { field: 'intensity', type: 'intensity', scale: null, offset: 0, units: '' }
    },
    30: {
      name: 'weight_scale',
      253: { field: 'timestamp', type: 'date_time', scale: null, offset: 0, units: 's' },
      0: { field: 'weight', type: 'weight', scale: 100, offset: 0, units: 'kg' },
      1: { field: 'percent_fat', type: 'uint16', scale: 100, offset: 0, units: '%' },
      2: { field: 'percent_hydration', type: 'uint16', scale: 100, offset: 0, units: '%' },
      3: { field: 'visceral_fat_mass', type: 'uint16', scale: 100, offset: 0, units: 'kg' },
      4: { field: 'bone_mass', type: 'uint16', scale: 100, offset: 0, units: 'kg' },
      5: { field: 'muscle_mass', type: 'uint16', scale: 100, offset: 0, units: 'kg' },
      7: { field: 'basal_met', type: 'uint16', scale: 4, offset: 0, units: 'kcal/day' },
      8: { field: 'physique_rating', type: 'uint8', scale: null, offset: 0, units: '' },
      9: { field: 'active_met', type: 'uint16', scale: 4, offset: 0, units: 'kcal/day' },
      10: { field: 'metabolic_age', type: 'uint8', scale: null, offset: 0, units: 'years' },
      11: { field: 'visceral_fat_rating', type: 'uint8', scale: null, offset: 0, units: '' },
      12: { field: 'user_profile_index', type: 'message_index', scale: null, offset: 0, units: '' }
    },
    31: {
      name: 'course',
      4: { field: 'sport', type: 'sport', scale: null, offset: '', units: '' },
      5: { field: 'name', type: 'string', scale: null, offset: '', units: '' },
      6: { field: 'capabilities', type: 'course_capabilities', scale: null, offset: '', units: '' }
    },
    32: {
      name: 'course_point',
      254: { field: 'message_index', type: 'message_index', scale: null, offset: 0, units: '' },
      1: { field: 'timestamp', type: 'date_time', scale: null, offset: 0, units: '' },
      2: { field: 'position_lat', type: 'sint32', scale: null, offset: 0, units: 'semicircles' },
      3: { field: 'position_long', type: 'sint32', scale: null, offset: 0, units: 'semicircles' },
      4: { field: 'distance', type: 'uint32', scale: 100, offset: 0, units: 'm' },
      5: { field: 'type', type: 'course_point', scale: null, offset: 0, units: '' },
      6: { field: 'name', type: 'string', scale: null, offset: 0, units: '' },
      8: { field: 'favorite', type: 'bool', scale: null, offset: 0, units: '' }
    },
    33: {
      name: 'totals',
      254: { field: 'message_index', type: 'message_index', scale: null, offset: 0, units: '' },
      253: { field: 'timestamp', type: 'date_time', scale: null, offset: 0, units: 's' },
      0: { field: 'timer_time', type: 'uint32', scale: null, offset: 0, units: 's' },
      1: { field: 'distance', type: 'uint32', scale: null, offset: 0, units: 'm' },
      2: { field: 'calories', type: 'uint32', scale: null, offset: 0, units: 'kcal' },
      3: { field: 'sport', type: 'sport', scale: null, offset: 0, units: '' },
      4: { field: 'elapsed_time', type: 'uint32', scale: null, offset: 0, units: 's' },
      5: { field: 'sessions', type: 'uint16', scale: null, offset: 0, units: '' },
      6: { field: 'active_time', type: 'uint32', scale: null, offset: 0, units: 's' },
      9: { field: 'sport_index', type: 'uint8', scale: null, offset: 0, units: '' }
    },
    34: {
      name: 'activity',
      253: { field: 'timestamp', type: 'date_time', scale: null, offset: 0, units: '' },
      0: { field: 'total_timer_time', type: 'uint32', scale: 1000, offset: 0, units: 's' },
      1: { field: 'num_sessions', type: 'uint16', scale: null, offset: 0, units: '' },
      2: { field: 'type', type: 'activity', scale: null, offset: 0, units: '' },
      3: { field: 'event', type: 'event', scale: null, offset: 0, units: '' },
      4: { field: 'event_type', type: 'event_type', scale: null, offset: 0, units: '' },
      5: { field: 'local_timestamp', type: 'local_date_time', scale: null, offset: 0, units: '' },
      6: { field: 'event_group', type: 'uint8', scale: null, offset: 0, units: '' }
    },
    35: {
      name: 'software',
      254: { field: 'message_index', type: 'message_index', scale: null, offset: '', units: '' },
      3: { field: 'version', type: 'uint16', scale: 100, offset: '', units: '' },
      5: { field: 'part_number', type: 'string', scale: null, offset: '', units: '' }
    },
    37: {
      name: 'file_capabilities',
      254: { field: 'message_index', type: 'message_index', scale: null, offset: 0, units: '' },
      0: { field: 'type', type: 'file', scale: null, offset: 0, units: '' },
      1: { field: 'flags', type: 'file_flags', scale: null, offset: 0, units: '' },
      2: { field: 'directory', type: 'string', scale: null, offset: 0, units: '' },
      3: { field: 'max_count', type: 'uint16', scale: null, offset: 0, units: '' },
      4: { field: 'max_size', type: 'uint32', scale: null, offset: 0, units: 'bytes' }
    },
    38: {
      name: 'mesg_capabilities',
      254: { field: 'message_index', type: 'message_index', scale: null, offset: '', units: '' },
      0: { field: 'file', type: 'file', scale: null, offset: '', units: '' },
      1: { field: 'mesg_num', type: 'mesg_num', scale: null, offset: '', units: '' },
      2: { field: 'count_type', type: 'mesg_count', scale: null, offset: '', units: '' },
      3: { field: 'count', type: 'uint16', scale: null, offset: '', units: '' }
    },
    39: {
      name: 'field_capabilities',
      254: { field: 'message_index', type: 'message_index', scale: null, offset: '', units: '' },
      0: { field: 'file', type: 'file', scale: null, offset: '', units: '' },
      1: { field: 'mesg_num', type: 'mesg_num', scale: null, offset: '', units: '' },
      2: { field: 'field_num', type: 'uint8', scale: null, offset: '', units: '' },
      3: { field: 'count', type: 'uint16', scale: null, offset: '', units: '' }
    },
    49: {
      name: 'file_creator',
      0: { field: 'software_version', type: 'uint16', scale: null, offset: '', units: '' },
      1: { field: 'hardware_version', type: 'uint8', scale: null, offset: '', units: '' }
    },
    51: {
      name: 'blood_pressure',
      253: { field: 'timestamp', type: 'date_time', scale: null, offset: 0, units: 's' },
      0: { field: 'systolic_pressure', type: 'uint16', scale: null, offset: 0, units: 'mmHg' },
      1: { field: 'diastolic_pressure', type: 'uint16', scale: null, offset: 0, units: 'mmHg' },
      2: { field: 'mean_arterial_pressure', type: 'uint16', scale: null, offset: 0, units: 'mmHg' },
      3: { field: 'map_3_sample_mean', type: 'uint16', scale: null, offset: 0, units: 'mmHg' },
      4: { field: 'map_morning_values', type: 'uint16', scale: null, offset: 0, units: 'mmHg' },
      5: { field: 'map_evening_values', type: 'uint16', scale: null, offset: 0, units: 'mmHg' },
      6: { field: 'heart_rate', type: 'uint8', scale: null, offset: 0, units: 'bpm' },
      7: { field: 'heart_rate_type', type: 'hr_type', scale: null, offset: 0, units: '' },
      8: { field: 'status', type: 'bp_status', scale: null, offset: 0, units: '' },
      9: { field: 'user_profile_index', type: 'message_index', scale: null, offset: 0, units: '' }
    }
  },
  types: {
    file: {
      1: 'device',
      2: 'settings',
      3: 'sport',
      4: 'activity',
      5: 'workout',
      6: 'course',
      7: 'schedules',
      9: 'weight',
      10: 'totals',
      11: 'goals',
      14: 'blood_pressure',
      15: 'monitoring_a',
      20: 'activity_summary',
      28: 'monitoring_daily',
      32: 'monitoring_b',
      34: 'segment',
      35: 'segment_list',
      40: 'exd_configuration',
      247: 'mfg_range_min',
      254: 'mfg_range_max'
    },
    mesg_num: {
      0: 'file_id',
      1: 'capabilities',
      2: 'device_settings',
      3: 'user_profile',
      4: 'hrm_profile',
      5: 'sdm_profile',
      6: 'bike_profile',
      7: 'zones_target',
      8: 'hr_zone',
      9: 'power_zone',
      10: 'met_zone',
      12: 'sport',
      15: 'goal',
      18: 'session',
      19: 'lap',
      20: 'record',
      21: 'event',
      23: 'device_info',
      26: 'workout',
      27: 'workout_step',
      28: 'schedule',
      30: 'weight_scale',
      31: 'course',
      32: 'course_point',
      33: 'totals',
      34: 'activity',
      35: 'software',
      37: 'file_capabilities',
      38: 'mesg_capabilities',
      39: 'field_capabilities',
      49: 'file_creator',
      51: 'blood_pressure',
      53: 'speed_zone',
      55: 'monitoring',
      72: 'training_file',
      78: 'hrv',
      80: 'ant_rx',
      81: 'ant_tx',
      82: 'ant_channel_id',
      101: 'length',
      103: 'monitoring_info',
      105: 'pad',
      106: 'slave_device',
      127: 'connectivity',
      128: 'weather_conditions',
      129: 'weather_alert',
      131: 'cadence_zone',
      132: 'hr',
      142: 'segment_lap',
      145: 'memo_glob',
      148: 'segment_id',
      149: 'segment_leaderboard_entry',
      150: 'segment_point',
      151: 'segment_file',
      160: 'gps_metadata',
      161: 'camera_event',
      162: 'timestamp_correlation',
      164: 'gyroscope_data',
      165: 'accelerometer_data',
      167: 'three_d_sensor_calibration',
      169: 'video_frame',
      174: 'obdii_data',
      177: 'nmea_sentence',
      178: 'aviation_attitude',
      184: 'video',
      185: 'video_title',
      186: 'video_description',
      187: 'video_clip',
      200: 'exd_screen_configuration',
      201: 'exd_data_field_configuration',
      202: 'exd_data_concept_configuration',
      206: 'field_description',
      207: 'developer_data_id',
      65280: 'mfg_range_min',
      65534: 'mfg_range_max'
    },
    checksum: {
      0: 'clear',
      1: 'ok'
    },
    file_flags: {
      0: 0,
      2: 'read',
      4: 'write',
      8: 'erase'
    },
    mesg_count: {
      0: 'num_per_file',
      1: 'max_per_file',
      2: 'max_per_file_type'
    },
    date_time: {
      0: 0,
      268435456: 'min'
    },
    local_date_time: {
      0: 0,
      268435456: 'min'
    },
    message_index: {
      0: 0,
      4095: 'mask',
      28672: 'reserved',
      32768: 'selected'
    },
    device_index: {
      0: 'creator'
    },
    gender: {
      0: 'female',
      1: 'male'
    },
    language: {
      0: 'english',
      1: 'french',
      2: 'italian',
      3: 'german',
      4: 'spanish',
      5: 'croatian',
      6: 'czech',
      7: 'danish',
      8: 'dutch',
      9: 'finnish',
      10: 'greek',
      11: 'hungarian',
      12: 'norwegian',
      13: 'polish',
      14: 'portuguese',
      15: 'slovakian',
      16: 'slovenian',
      17: 'swedish',
      18: 'russian',
      19: 'turkish',
      20: 'latvian',
      21: 'ukrainian',
      22: 'arabic',
      23: 'farsi',
      24: 'bulgarian',
      25: 'romanian',
      26: 'chinese',
      27: 'japanese',
      28: 'korean',
      29: 'taiwanese',
      30: 'thai',
      31: 'hebrew',
      32: 'brazilian_portuguese',
      33: 'indonesian',
      254: 'custom'
    },
    language_bits_0: {
      0: 0,
      1: 'english',
      2: 'french',
      4: 'italian',
      8: 'german',
      16: 'spanish',
      32: 'croatian',
      64: 'czech',
      128: 'danish'
    },
    language_bits_1: {
      0: 0,
      1: 'dutch',
      2: 'finnish',
      4: 'greek',
      8: 'hungarian',
      16: 'norwegian',
      32: 'polish',
      64: 'portuguese',
      128: 'slovakian'
    },
    language_bits_2: {
      0: 0,
      1: 'slovenian',
      2: 'swedish',
      4: 'russian',
      8: 'turkish',
      16: 'latvian',
      32: 'ukrainian',
      64: 'arabic',
      128: 'farsi'
    },
    language_bits_3: {
      0: 0,
      1: 'bulgarian',
      2: 'romanian',
      4: 'chinese',
      8: 'japanese',
      16: 'korean',
      32: 'taiwanese',
      64: 'thai',
      128: 'hebrew'
    },
    language_bits_4: {
      1: 'brazilian_portuguese',
      2: 'indonesian'
    },
    time_zone: {
      0: 'almaty',
      1: 'bangkok',
      2: 'bombay',
      3: 'brasilia',
      4: 'cairo',
      5: 'cape_verde_is',
      6: 'darwin',
      7: 'eniwetok',
      8: 'fiji',
      9: 'hong_kong',
      10: 'islamabad',
      11: 'kabul',
      12: 'magadan',
      13: 'mid_atlantic',
      14: 'moscow',
      15: 'muscat',
      16: 'newfoundland',
      17: 'samoa',
      18: 'sydney',
      19: 'tehran',
      20: 'tokyo',
      21: 'us_alaska',
      22: 'us_atlantic',
      23: 'us_central',
      24: 'us_eastern',
      25: 'us_hawaii',
      26: 'us_mountain',
      27: 'us_pacific',
      28: 'other',
      29: 'auckland',
      30: 'kathmandu',
      31: 'europe_western_wet',
      32: 'europe_central_cet',
      33: 'europe_eastern_eet',
      34: 'jakarta',
      35: 'perth',
      36: 'adelaide',
      37: 'brisbane',
      38: 'tasmania',
      39: 'iceland',
      40: 'amsterdam',
      41: 'athens',
      42: 'barcelona',
      43: 'berlin',
      44: 'brussels',
      45: 'budapest',
      46: 'copenhagen',
      47: 'dublin',
      48: 'helsinki',
      49: 'lisbon',
      50: 'london',
      51: 'madrid',
      52: 'munich',
      53: 'oslo',
      54: 'paris',
      55: 'prague',
      56: 'reykjavik',
      57: 'rome',
      58: 'stockholm',
      59: 'vienna',
      60: 'warsaw',
      61: 'zurich',
      62: 'quebec',
      63: 'ontario',
      64: 'manitoba',
      65: 'saskatchewan',
      66: 'alberta',
      67: 'british_columbia',
      68: 'boise',
      69: 'boston',
      70: 'chicago',
      71: 'dallas',
      72: 'denver',
      73: 'kansas_city',
      74: 'las_vegas',
      75: 'los_angeles',
      76: 'miami',
      77: 'minneapolis',
      78: 'new_york',
      79: 'new_orleans',
      80: 'phoenix',
      81: 'santa_fe',
      82: 'seattle',
      83: 'washington_dc',
      84: 'us_arizona',
      85: 'chita',
      86: 'ekaterinburg',
      87: 'irkutsk',
      88: 'kaliningrad',
      89: 'krasnoyarsk',
      90: 'novosibirsk',
      91: 'petropavlovsk_kamchatskiy',
      92: 'samara',
      93: 'vladivostok',
      94: 'mexico_central',
      95: 'mexico_mountain',
      96: 'mexico_pacific',
      97: 'cape_town',
      98: 'winkhoek',
      99: 'lagos',
      100: 'riyahd',
      101: 'venezuela',
      102: 'australia_lh',
      103: 'santiago',
      253: 'manual',
      254: 'automatic'
    },
    display_measure: {
      0: 'metric',
      1: 'statute'
    },
    display_heart: {
      0: 'bpm',
      1: 'max',
      2: 'reserve'
    },
    display_power: {
      0: 'watts',
      1: 'percent_ftp'
    },
    display_position: {
      0: 'degree',
      1: 'degree_minute',
      2: 'degree_minute_second',
      3: 'austrian_grid',
      4: 'british_grid',
      5: 'dutch_grid',
      6: 'hungarian_grid',
      7: 'finnish_grid',
      8: 'german_grid',
      9: 'icelandic_grid',
      10: 'indonesian_equatorial',
      11: 'indonesian_irian',
      12: 'indonesian_southern',
      13: 'india_zone_0',
      14: 'india_zone_IA',
      15: 'india_zone_IB',
      16: 'india_zone_IIA',
      17: 'india_zone_IIB',
      18: 'india_zone_IIIA',
      19: 'india_zone_IIIB',
      20: 'india_zone_IVA',
      21: 'india_zone_IVB',
      22: 'irish_transverse',
      23: 'irish_grid',
      24: 'loran',
      25: 'maidenhead_grid',
      26: 'mgrs_grid',
      27: 'new_zealand_grid',
      28: 'new_zealand_transverse',
      29: 'qatar_grid',
      30: 'modified_swedish_grid',
      31: 'swedish_grid',
      32: 'south_african_grid',
      33: 'swiss_grid',
      34: 'taiwan_grid',
      35: 'united_states_grid',
      36: 'utm_ups_grid',
      37: 'west_malayan',
      38: 'borneo_rso',
      39: 'estonian_grid',
      40: 'latvian_grid',
      41: 'swedish_ref_99_grid'
    },
    sport: {
      0: 'generic',
      1: 'running',
      2: 'cycling',
      3: 'transition',
      4: 'fitness_equipment',
      5: 'swimming',
      6: 'basketball',
      7: 'soccer',
      8: 'tennis',
      9: 'american_football',
      10: 'training',
      11: 'walking',
      12: 'cross_country_skiing',
      13: 'alpine_skiing',
      14: 'snowboarding',
      15: 'rowing',
      16: 'mountaineering',
      17: 'hiking',
      18: 'multisport',
      19: 'paddling',
      20: 'flying',
      21: 'e_biking',
      22: 'motorcycling',
      23: 'boating',
      24: 'driving',
      25: 'golf',
      26: 'hang_gliding',
      27: 'horseback_riding',
      28: 'hunting',
      29: 'fishing',
      30: 'inline_skating',
      31: 'rock_climbing',
      32: 'sailing',
      33: 'ice_skating',
      34: 'sky_diving',
      35: 'snowshoeing',
      36: 'snowmobiling',
      37: 'stand_up_paddleboarding',
      38: 'surfing',
      39: 'wakeboarding',
      40: 'water_skiing',
      41: 'kayaking',
      42: 'rafting',
      43: 'windsurfing',
      44: 'kitesurfing',
      45: 'tactical',
      46: 'jumpmaster',
      254: 'all'
    },
    sport_bits_0: {
      0: 0,
      1: 'generic',
      2: 'running',
      4: 'cycling',
      8: 'transition',
      16: 'fitness_equipment',
      32: 'swimming',
      64: 'basketball',
      128: 'soccer'
    },
    sport_bits_1: {
      0: 0,
      1: 'tennis',
      2: 'american_football',
      4: 'training',
      8: 'walking',
      16: 'cross_country_skiing',
      32: 'alpine_skiing',
      64: 'snowboarding',
      128: 'rowing'
    },
    sport_bits_2: {
      0: 0,
      1: 'mountaineering',
      2: 'hiking',
      4: 'multisport',
      8: 'paddling',
      16: 'flying',
      32: 'e_biking',
      64: 'motorcycling',
      128: 'boating'
    },
    sport_bits_3: {
      0: 0,
      1: 'driving',
      2: 'golf',
      4: 'hang_gliding',
      8: 'horseback_riding',
      16: 'hunting',
      32: 'fishing',
      64: 'inline_skating',
      128: 'rock_climbing'
    },
    sport_bits_4: {
      0: 0,
      1: 'sailing',
      2: 'ice_skating',
      4: 'sky_diving',
      8: 'snowshoeing',
      16: 'snowmobiling',
      32: 'stand_up_paddleboarding',
      64: 'surfing',
      128: 'wakeboarding'
    },
    sport_bits_5: {
      0: 0,
      1: 'water_skiing',
      2: 'kayaking',
      4: 'rafting',
      8: 'windsurfing',
      16: 'kitesurfing',
      32: 'tactical',
      64: 'jumpmaster'
    },
    sub_sport: {
      0: 'generic',
      1: 'treadmill',
      2: 'street',
      3: 'trail',
      4: 'track',
      5: 'spin',
      6: 'indoor_cycling',
      7: 'road',
      8: 'mountain',
      9: 'downhill',
      10: 'recumbent',
      11: 'cyclocross',
      12: 'hand_cycling',
      13: 'track_cycling',
      14: 'indoor_rowing',
      15: 'elliptical',
      16: 'stair_climbing',
      17: 'lap_swimming',
      18: 'open_water',
      19: 'flexibility_training',
      20: 'strength_training',
      21: 'warm_up',
      22: 'match',
      23: 'exercise',
      24: 'challenge',
      25: 'indoor_skiing',
      26: 'cardio_training',
      27: 'indoor_walking',
      28: 'e_bike_fitness',
      29: 'bmx',
      30: 'casual_walking',
      31: 'speed_walking',
      32: 'bike_to_run_transition',
      33: 'run_to_bike_transition',
      34: 'swim_to_bike_transition',
      35: 'atv',
      36: 'motocross',
      37: 'backcountry',
      38: 'resort',
      39: 'rc_drone',
      40: 'wingsuit',
      41: 'whitewater',
      42: 'skate_skiing',
      43: 'yoga',
      44: 'pilates',
      45: 'indoor_running',
      46: 'gravel_cycling',
      47: 'e_bike_mountain',
      48: 'commuting',
      254: 'all'
    },
    sport_event: {
      0: 'uncategorized',
      1: 'geocaching',
      2: 'fitness',
      3: 'recreation',
      4: 'race',
      5: 'special_event',
      6: 'training',
      7: 'transportation',
      8: 'touring'
    },
    activity: {
      0: 'manual',
      1: 'auto_multi_sport'
    },
    intensity: {
      0: 'active',
      1: 'rest',
      2: 'warmup',
      3: 'cooldown'
    },
    session_trigger: {
      0: 'activity_end',
      1: 'manual',
      2: 'auto_multi_sport',
      3: 'fitness_equipment'
    },
    autolap_trigger: {
      0: 'time',
      1: 'distance',
      2: 'position_start',
      3: 'position_lap',
      4: 'position_waypoint',
      5: 'position_marked',
      6: 'off'
    },
    lap_trigger: {
      0: 'manual',
      1: 'time',
      2: 'distance',
      3: 'position_start',
      4: 'position_lap',
      5: 'position_waypoint',
      6: 'position_marked',
      7: 'session_end',
      8: 'fitness_equipment'
    },
    time_mode: {
      0: 'hour12',
      1: 'hour24',
      2: 'military',
      3: 'hour_12_with_seconds',
      4: 'hour_24_with_seconds'
    },
    event: {
      0: 'timer',
      3: 'workout',
      4: 'workout_step',
      5: 'power_down',
      6: 'power_up',
      7: 'off_course',
      8: 'session',
      9: 'lap',
      10: 'course_point',
      11: 'battery',
      12: 'virtual_partner_pace',
      13: 'hr_high_alert',
      14: 'hr_low_alert',
      15: 'speed_high_alert',
      16: 'speed_low_alert',
      17: 'cad_high_alert',
      18: 'cad_low_alert',
      19: 'power_high_alert',
      20: 'power_low_alert',
      21: 'recovery_hr',
      22: 'battery_low',
      23: 'time_duration_alert',
      24: 'distance_duration_alert',
      25: 'calorie_duration_alert',
      26: 'activity',
      27: 'fitness_equipment',
      28: 'length',
      32: 'user_marker',
      33: 'sport_point',
      36: 'calibration',
      42: 'front_gear_change',
      43: 'rear_gear_change',
      44: 'rider_position_change',
      45: 'elev_high_alert',
      46: 'elev_low_alert',
      47: 'comm_timeout'
    },
    event_type: {
      0: 'start',
      1: 'stop',
      2: 'consecutive_depreciated',
      3: 'marker',
      4: 'stop_all',
      5: 'begin_depreciated',
      6: 'end_depreciated',
      7: 'end_all_depreciated',
      8: 'stop_disable',
      9: 'stop_disable_all'
    },
    timer_trigger: {
      0: 'manual',
      1: 'auto',
      2: 'fitness_equipment'
    },
    fitness_equipment_state: {
      0: 'ready',
      1: 'in_use',
      2: 'paused',
      3: 'unknown'
    },
    autoscroll: {
      0: 'none',
      1: 'slow',
      2: 'medium',
      3: 'fast'
    },
    activity_class: {
      0: 0,
      100: 'level_max',
      127: 'level',
      128: 'athlete'
    },
    hr_zone_calc: {
      0: 'custom',
      1: 'percent_max_hr',
      2: 'percent_hrr'
    },
    pwr_zone_calc: {
      0: 'custom',
      1: 'percent_ftp'
    },
    wkt_step_duration: {
      0: 'time',
      1: 'distance',
      2: 'hr_less_than',
      3: 'hr_greater_than',
      4: 'calories',
      5: 'open',
      6: 'repeat_until_steps_cmplt',
      7: 'repeat_until_time',
      8: 'repeat_until_distance',
      9: 'repeat_until_calories',
      10: 'repeat_until_hr_less_than',
      11: 'repeat_until_hr_greater_than',
      12: 'repeat_until_power_less_than',
      13: 'repeat_until_power_greater_than',
      14: 'power_less_than',
      15: 'power_greater_than',
      28: 'repetition_time'
    },
    wkt_step_target: {
      0: 'speed',
      1: 'heart_rate',
      2: 'open',
      3: 'cadence',
      4: 'power',
      5: 'grade',
      6: 'resistance'
    },
    goal: {
      0: 'time',
      1: 'distance',
      2: 'calories',
      3: 'frequency',
      4: 'steps'
    },
    goal_recurrence: {
      0: 'off',
      1: 'daily',
      2: 'weekly',
      3: 'monthly',
      4: 'yearly',
      5: 'custom'
    },
    schedule: {
      0: 'workout',
      1: 'course'
    },
    course_point: {
      0: 'generic',
      1: 'summit',
      2: 'valley',
      3: 'water',
      4: 'food',
      5: 'danger',
      6: 'left',
      7: 'right',
      8: 'straight',
      9: 'first_aid',
      10: 'fourth_category',
      11: 'third_category',
      12: 'second_category',
      13: 'first_category',
      14: 'hors_category',
      15: 'sprint',
      16: 'left_fork',
      17: 'right_fork',
      18: 'middle_fork',
      19: 'slight_left',
      20: 'sharp_left',
      21: 'slight_right',
      22: 'sharp_right',
      23: 'u_turn',
      24: 'segment_start',
      25: 'segment_end'
    },
    manufacturer: {
      0: 0,
      1: 'garmin',
      2: 'garmin_fr405_antfs',
      3: 'zephyr',
      4: 'dayton',
      5: 'idt',
      6: 'srm',
      7: 'quarq',
      8: 'ibike',
      9: 'saris',
      10: 'spark_hk',
      11: 'tanita',
      12: 'echowell',
      13: 'dynastream_oem',
      14: 'nautilus',
      15: 'dynastream',
      16: 'timex',
      17: 'metrigear',
      18: 'xelic',
      19: 'beurer',
      20: 'cardiosport',
      21: 'a_and_d',
      22: 'hmm',
      23: 'suunto',
      24: 'thita_elektronik',
      25: 'gpulse',
      26: 'clean_mobile',
      27: 'pedal_brain',
      28: 'peaksware',
      29: 'saxonar',
      30: 'lemond_fitness',
      31: 'dexcom',
      32: 'wahoo_fitness',
      33: 'octane_fitness',
      34: 'archinoetics',
      35: 'the_hurt_box',
      36: 'citizen_systems',
      37: 'magellan',
      38: 'osynce',
      39: 'holux',
      40: 'concept2',
      42: 'one_giant_leap',
      43: 'ace_sensor',
      44: 'brim_brothers',
      45: 'xplova',
      46: 'perception_digital',
      47: 'bf1systems',
      48: 'pioneer',
      49: 'spantec',
      50: 'metalogics',
      51: '4iiiis',
      52: 'seiko_epson',
      53: 'seiko_epson_oem',
      54: 'ifor_powell',
      55: 'maxwell_guider',
      56: 'star_trac',
      57: 'breakaway',
      58: 'alatech_technology_ltd',
      59: 'mio_technology_europe',
      60: 'rotor',
      61: 'geonaute',
      62: 'id_bike',
      63: 'specialized',
      64: 'wtek',
      65: 'physical_enterprises',
      66: 'north_pole_engineering',
      67: 'bkool',
      68: 'cateye',
      69: 'stages_cycling',
      70: 'sigmasport',
      71: 'tomtom',
      72: 'peripedal',
      73: 'wattbike',
      76: 'moxy',
      77: 'ciclosport',
      78: 'powerbahn',
      79: 'acorn_projects_aps',
      80: 'lifebeam',
      81: 'bontrager',
      82: 'wellgo',
      83: 'scosche',
      84: 'magura',
      85: 'woodway',
      86: 'elite',
      87: 'nielsen_kellerman',
      88: 'dk_city',
      89: 'tacx',
      90: 'direction_technology',
      91: 'magtonic',
      92: '1partcarbon',
      93: 'inside_ride_technologies',
      94: 'sound_of_motion',
      95: 'stryd',
      96: 'icg',
      97: 'MiPulse',
      98: 'bsx_athletics',
      99: 'look',
      100: 'campagnolo_srl',
      101: 'body_bike_smart',
      102: 'praxisworks',
      103: 'limits_technology',
      104: 'topaction_technology',
      105: 'cosinuss',
      255: 'development',
      257: 'healthandlife',
      258: 'lezyne',
      259: 'scribe_labs',
      260: 'zwift',
      261: 'watteam',
      262: 'recon',
      263: 'favero_electronics',
      264: 'dynovelo',
      265: 'strava',
      266: 'precor',
      267: 'bryton',
      268: 'sram',
      269: 'navman',
      270: 'cobi',
      271: 'spivi',
      272: 'mio_magellan',
      273: 'evesports',
      5759: 'actigraphcorp'
    },
    garmin_product: {
      0: 0,
      1: 'hrm1',
      2: 'axh01',
      3: 'axb01',
      4: 'axb02',
      5: 'hrm2ss',
      6: 'dsi_alf02',
      7: 'hrm3ss',
      8: 'hrm_run_single_byte_product_id',
      9: 'bsm',
      10: 'bcm',
      11: 'axs01',
      12: 'hrm_tri_single_byte_product_id',
      14: 'fr225_single_byte_product_id',
      473: 'fr301_china',
      474: 'fr301_japan',
      475: 'fr301_korea',
      494: 'fr301_taiwan',
      717: 'fr405',
      782: 'fr50',
      987: 'fr405_japan',
      988: 'fr60',
      1011: 'dsi_alf01',
      1018: 'fr310xt',
      1036: 'edge500',
      1124: 'fr110',
      1169: 'edge800',
      1199: 'edge500_taiwan',
      1213: 'edge500_japan',
      1253: 'chirp',
      1274: 'fr110_japan',
      1325: 'edge200',
      1328: 'fr910xt',
      1333: 'edge800_taiwan',
      1334: 'edge800_japan',
      1341: 'alf04',
      1345: 'fr610',
      1360: 'fr210_japan',
      1380: 'vector_ss',
      1381: 'vector_cp',
      1386: 'edge800_china',
      1387: 'edge500_china',
      1410: 'fr610_japan',
      1422: 'edge500_korea',
      1436: 'fr70',
      1446: 'fr310xt_4t',
      1461: 'amx',
      1482: 'fr10',
      1497: 'edge800_korea',
      1499: 'swim',
      1537: 'fr910xt_china',
      1551: 'fenix',
      1555: 'edge200_taiwan',
      1561: 'edge510',
      1567: 'edge810',
      1570: 'tempe',
      1600: 'fr910xt_japan',
      1623: 'fr620',
      1632: 'fr220',
      1664: 'fr910xt_korea',
      1688: 'fr10_japan',
      1721: 'edge810_japan',
      1735: 'virb_elite',
      1736: 'edge_touring',
      1742: 'edge510_japan',
      1743: 'hrm_tri',
      1752: 'hrm_run',
      1765: 'fr920xt',
      1821: 'edge510_asia',
      1822: 'edge810_china',
      1823: 'edge810_taiwan',
      1836: 'edge1000',
      1837: 'vivo_fit',
      1853: 'virb_remote',
      1885: 'vivo_ki',
      1903: 'fr15',
      1907: 'vivo_active',
      1918: 'edge510_korea',
      1928: 'fr620_japan',
      1929: 'fr620_china',
      1930: 'fr220_japan',
      1931: 'fr220_china',
      1936: 'approach_s6',
      1956: 'vivo_smart',
      1967: 'fenix2',
      1988: 'epix',
      2050: 'fenix3',
      2052: 'edge1000_taiwan',
      2053: 'edge1000_japan',
      2061: 'fr15_japan',
      2067: 'edge520',
      2070: 'edge1000_china',
      2072: 'fr620_russia',
      2073: 'fr220_russia',
      2079: 'vector_s',
      2100: 'edge1000_korea',
      2130: 'fr920xt_taiwan',
      2131: 'fr920xt_china',
      2132: 'fr920xt_japan',
      2134: 'virbx',
      2135: 'vivo_smart_apac',
      2140: 'etrex_touch',
      2147: 'edge25',
      2148: 'fr25',
      2150: 'vivo_fit2',
      2153: 'fr225',
      2156: 'fr630',
      2157: 'fr230',
      2160: 'vivo_active_apac',
      2161: 'vector_2',
      2162: 'vector_2s',
      2172: 'virbxe',
      2173: 'fr620_taiwan',
      2174: 'fr220_taiwan',
      2175: 'truswing',
      2188: 'fenix3_china',
      2189: 'fenix3_twn',
      2192: 'varia_headlight',
      2193: 'varia_taillight_old',
      2204: 'edge_explore_1000',
      2219: 'fr225_asia',
      2225: 'varia_radar_taillight',
      2226: 'varia_radar_display',
      2238: 'edge20',
      2262: 'd2_bravo',
      2266: 'approach_s20',
      2276: 'varia_remote',
      2327: 'hrm4_run',
      2337: 'vivo_active_hr',
      2348: 'vivo_smart_hr',
      2398: 'varia_vision',
      2406: 'vivo_fit3',
      2413: 'fenix3_hr',
      2429: 'index_smart_scale',
      2431: 'fr235',
      2496: 'nautix',
      10007: 'sdm4',
      10014: 'edge_remote',
      20119: 'training_center',
      65531: 'connectiq_simulator',
      65532: 'android_antplus_plugin',
      65534: 'connect'
    },
    antplus_device_type: {
      0: 0,
      1: 'antfs',
      11: 'bike_power',
      12: 'environment_sensor_legacy',
      15: 'multi_sport_speed_distance',
      16: 'control',
      17: 'fitness_equipment',
      18: 'blood_pressure',
      19: 'geocache_node',
      20: 'light_electric_vehicle',
      25: 'env_sensor',
      26: 'racquet',
      27: 'control_hub',
      31: 'muscle_oxygen',
      35: 'bike_light_main',
      36: 'bike_light_shared',
      38: 'exd',
      40: 'bike_radar',
      119: 'weight_scale',
      120: 'heart_rate',
      121: 'bike_speed_cadence',
      122: 'bike_cadence',
      123: 'bike_speed',
      124: 'stride_speed_distance'
    },
    ant_network: {
      0: 'public',
      1: 'antplus',
      2: 'antfs',
      3: 'private'
    },
    workout_capabilities: {
      0: 0,
      1: 'interval',
      2: 'custom',
      4: 'fitness_equipment',
      8: 'firstbeat',
      16: 'new_leaf',
      32: 'tcx',
      128: 'speed',
      256: 'heart_rate',
      512: 'distance',
      1024: 'cadence',
      2048: 'power',
      4096: 'grade',
      8192: 'resistance',
      16384: 'protected'
    },
    battery_status: {
      0: 0,
      1: 'new',
      2: 'good',
      3: 'ok',
      4: 'low',
      5: 'critical',
      6: 'charging',
      7: 'unknown'
    },
    hr_type: {
      0: 'normal',
      1: 'irregular'
    },
    course_capabilities: {
      0: 0,
      1: 'processed',
      2: 'valid',
      4: 'time',
      8: 'distance',
      16: 'position',
      32: 'heart_rate',
      64: 'power',
      128: 'cadence',
      256: 'training',
      512: 'navigation',
      1024: 'bikeway'
    },
    weight: {
      0: 0,
      65534: 'calculating'
    },
    workout_hr: {
      0: 0,
      100: 'bpm_offset'
    },
    workout_power: {
      0: 0,
      1000: 'watts_offset'
    },
    bp_status: {
      0: 'no_error',
      1: 'error_incomplete_data',
      2: 'error_no_measurement',
      3: 'error_data_out_of_range',
      4: 'error_irregular_heart_rate'
    },
    user_local_id: {
      0: 'local_min',
      15: 'local_max',
      16: 'stationary_min',
      255: 'stationary_max',
      256: 'portable_min',
      65534: 'portable_max'
    },
    swim_stroke: {
      0: 'freestyle',
      1: 'backstroke',
      2: 'breaststroke',
      3: 'butterfly',
      4: 'drill',
      5: 'mixed',
      6: 'im'
    },
    activity_type: {
      0: 'generic',
      1: 'running',
      2: 'cycling',
      3: 'transition',
      4: 'fitness_equipment',
      5: 'swimming',
      6: 'walking',
      254: 'all'
    },
    activity_subtype: {
      0: 'generic',
      1: 'treadmill',
      2: 'street',
      3: 'trail',
      4: 'track',
      5: 'spin',
      6: 'indoor_cycling',
      7: 'road',
      8: 'mountain',
      9: 'downhill',
      10: 'recumbent',
      11: 'cyclocross',
      12: 'hand_cycling',
      13: 'track_cycling',
      14: 'indoor_rowing',
      15: 'elliptical',
      16: 'stair_climbing',
      17: 'lap_swimming',
      18: 'open_water',
      254: 'all'
    },
    activity_level: {
      0: 'low',
      1: 'medium',
      2: 'high'
    },
    side: {
      0: 'right',
      1: 'left'
    },
    left_right_balance: {
      0: 0,
      127: 'mask',
      128: 'right'
    },
    left_right_balance_100: {
      0: 0,
      16383: 'mask',
      32768: 'right'
    },
    length_type: {
      0: 'idle',
      1: 'active'
    },
    day_of_week: {
      0: 'sunday',
      1: 'monday',
      2: 'tuesday',
      3: 'wednesday',
      4: 'thursday',
      5: 'friday',
      6: 'saturday'
    },
    connectivity_capabilities: {
      0: 0,
      1: 'bluetooth',
      2: 'bluetooth_le',
      4: 'ant',
      8: 'activity_upload',
      16: 'course_download',
      32: 'workout_download',
      64: 'live_track',
      128: 'weather_conditions',
      256: 'weather_alerts',
      512: 'gps_ephemeris_download',
      1024: 'explicit_archive',
      2048: 'setup_incomplete',
      4096: 'continue_sync_after_software_update',
      8192: 'connect_iq_app_download',
      16384: 'golf_course_download',
      32768: 'device_initiates_sync',
      65536: 'connect_iq_watch_app_download',
      131072: 'connect_iq_widget_download',
      262144: 'connect_iq_watch_face_download',
      524288: 'connect_iq_data_field_download',
      1048576: 'connect_iq_app_managment',
      2097152: 'swing_sensor',
      4194304: 'swing_sensor_remote',
      8388608: 'incident_detection',
      16777216: 'audio_prompts',
      33554432: 'wifi_verification',
      67108864: 'true_up',
      134217728: 'find_my_watch',
      268435456: 'remote_manual_sync'
    },
    weather_report: {
      0: 'current',
      1: 'forecast',
      2: 'daily_forecast'
    },
    weather_status: {
      0: 'clear',
      1: 'partly_cloudy',
      2: 'mostly_cloudy',
      3: 'rain',
      4: 'snow',
      5: 'windy',
      6: 'thunderstorms',
      7: 'wintry_mix',
      8: 'fog',
      11: 'hazy',
      12: 'hail',
      13: 'scattered_showers',
      14: 'scattered_thunderstorms',
      15: 'unknown_precipitation',
      16: 'light_rain',
      17: 'heavy_rain',
      18: 'light_snow',
      19: 'heavy_snow',
      20: 'light_rain_snow',
      21: 'heavy_rain_snow',
      22: 'cloudy'
    },
    weather_severity: {
      0: 'unknown',
      1: 'warning',
      2: 'watch',
      3: 'advisory',
      4: 'statement'
    },
    weather_severe_type: {
      0: 'unspecified',
      1: 'tornado',
      2: 'tsunami',
      3: 'hurricane',
      4: 'extreme_wind',
      5: 'typhoon',
      6: 'inland_hurricane',
      7: 'hurricane_force_wind',
      8: 'waterspout',
      9: 'severe_thunderstorm',
      10: 'wreckhouse_winds',
      11: 'les_suetes_wind',
      12: 'avalanche',
      13: 'flash_flood',
      14: 'tropical_storm',
      15: 'inland_tropical_storm',
      16: 'blizzard',
      17: 'ice_storm',
      18: 'freezing_rain',
      19: 'debris_flow',
      20: 'flash_freeze',
      21: 'dust_storm',
      22: 'high_wind',
      23: 'winter_storm',
      24: 'heavy_freezing_spray',
      25: 'extreme_cold',
      26: 'wind_chill',
      27: 'cold_wave',
      28: 'heavy_snow_alert',
      29: 'lake_effect_blowing_snow',
      30: 'snow_squall',
      31: 'lake_effect_snow',
      32: 'winter_weather',
      33: 'sleet',
      34: 'snowfall',
      35: 'snow_and_blowing_snow',
      36: 'blowing_snow',
      37: 'snow_alert',
      38: 'arctic_outflow',
      39: 'freezing_drizzle',
      40: 'storm',
      41: 'storm_surge',
      42: 'rainfall',
      43: 'areal_flood',
      44: 'coastal_flood',
      45: 'lakeshore_flood',
      46: 'excessive_heat',
      47: 'heat',
      48: 'weather',
      49: 'high_heat_and_humidity',
      50: 'humidex_and_health',
      51: 'humidex',
      52: 'gale',
      53: 'freezing_spray',
      54: 'special_marine',
      55: 'squall',
      56: 'strong_wind',
      57: 'lake_wind',
      58: 'marine_weather',
      59: 'wind',
      60: 'small_craft_hazardous_seas',
      61: 'hazardous_seas',
      62: 'small_craft',
      63: 'small_craft_winds',
      64: 'small_craft_rough_bar',
      65: 'high_water_level',
      66: 'ashfall',
      67: 'freezing_fog',
      68: 'dense_fog',
      69: 'dense_smoke',
      70: 'blowing_dust',
      71: 'hard_freeze',
      72: 'freeze',
      73: 'frost',
      74: 'fire_weather',
      75: 'flood',
      76: 'rip_tide',
      77: 'high_surf',
      78: 'smog',
      79: 'air_quality',
      80: 'brisk_wind',
      81: 'air_stagnation',
      82: 'low_water',
      83: 'hydrological',
      84: 'special_weather'
    },
    stroke_type: {
      0: 'no_event',
      1: 'other',
      2: 'serve',
      3: 'forehand',
      4: 'backhand',
      5: 'smash'
    },
    body_location: {
      0: 'left_leg',
      1: 'left_calf',
      2: 'left_shin',
      3: 'left_hamstring',
      4: 'left_quad',
      5: 'left_glute',
      6: 'right_leg',
      7: 'right_calf',
      8: 'right_shin',
      9: 'right_hamstring',
      10: 'right_quad',
      11: 'right_glute',
      12: 'torso_back',
      13: 'left_lower_back',
      14: 'left_upper_back',
      15: 'right_lower_back',
      16: 'right_upper_back',
      17: 'torso_front',
      18: 'left_abdomen',
      19: 'left_chest',
      20: 'right_abdomen',
      21: 'right_chest',
      22: 'left_arm',
      23: 'left_shoulder',
      24: 'left_bicep',
      25: 'left_tricep',
      26: 'left_brachioradialis',
      27: 'left_forearm_extensors',
      28: 'right_arm',
      29: 'right_shoulder',
      30: 'right_bicep',
      31: 'right_tricep',
      32: 'right_brachioradialis',
      33: 'right_forearm_extensors',
      34: 'neck',
      35: 'throat'
    },
    segment_lap_status: {
      0: 'end',
      1: 'fail'
    },
    segment_leaderboard_type: {
      0: 'overall',
      1: 'personal_best',
      2: 'connections',
      3: 'group',
      4: 'challenger',
      5: 'kom',
      6: 'qom',
      7: 'pr',
      8: 'goal',
      9: 'rival',
      10: 'club_leader'
    },
    segment_delete_status: {
      0: 'do_not_delete',
      1: 'delete_one',
      2: 'delete_all'
    },
    segment_selection_type: {
      0: 'starred',
      1: 'suggested'
    },
    source_type: {
      0: 'ant',
      1: 'antplus',
      2: 'bluetooth',
      3: 'bluetooth_low_energy',
      4: 'wifi',
      5: 'local'
    },
    display_orientation: {
      0: 'auto',
      1: 'portrait',
      2: 'landscape',
      3: 'portrait_flipped',
      4: 'landscape_flipped'
    },
    rider_position_type: {
      0: 'seated',
      1: 'standing'
    },
    power_phase_type: {
      0: 'power_phase_start_angle',
      1: 'power_phase_end_angle',
      2: 'power_phase_arc_length',
      3: 'power_phase_center'
    },
    camera_event_type: {
      0: 'video_start',
      1: 'video_split',
      2: 'video_end',
      3: 'photo_taken',
      4: 'video_second_stream_start',
      5: 'video_second_stream_split',
      6: 'video_second_stream_end',
      7: 'video_split_start',
      8: 'video_second_stream_split_start'
    },
    sensor_type: {
      0: 'accelerometer',
      1: 'gyroscope',
      2: 'compass'
    },
    bike_light_network_config_type: {
      0: 'auto',
      4: 'individual',
      5: 'high_visibility'
    },
    comm_timeout_type: {
      0: 'wildcard_pairing_timeout',
      1: 'pairing_timeout',
      2: 'connection_lost',
      3: 'connection_timeout'
    },
    camera_orientation_type: {
      0: 'camera_orientation_0',
      1: 'camera_orientation_90',
      2: 'camera_orientation_180',
      3: 'camera_orientation_270'
    },
    attitude_stage: {
      0: 'failed',
      1: 'aligning',
      2: 'degraded',
      3: 'valid'
    },
    attitude_validity: {
      0: 0,
      1: 'track_angle_heading_valid',
      2: 'pitch_valid',
      4: 'roll_valid',
      8: 'lateral_body_accel_valid',
      16: 'normal_body_accel_valid',
      32: 'turn_rate_valid',
      64: 'hw_fail',
      128: 'mag_invalid',
      256: 'no_gps',
      512: 'gps_invalid',
      1024: 'solution_coasting',
      2048: 'true_track_angle',
      4096: 'magnetic_heading'
    },
    exd_layout: {
      0: 'full_screen',
      1: 'half_vertical',
      2: 'half_horizontal',
      3: 'half_vertical_right_split',
      4: 'half_horizontal_bottom_split',
      5: 'full_quarter_split',
      6: 'half_vertical_left_split',
      7: 'half_horizontal_top_split'
    },
    exd_display_type: {
      0: 'numerical',
      1: 'simple',
      2: 'graph',
      3: 'bar',
      4: 'circle_graph',
      5: 'virtual_partner',
      6: 'balance',
      7: 'string_list',
      8: 'string',
      9: 'simple_dynamic_icon',
      10: 'gauge'
    },
    exd_data_units: {
      0: 'no_units',
      1: 'laps',
      2: 'miles_per_hour',
      3: 'kilometers_per_hour',
      4: 'feet_per_hour',
      5: 'meters_per_hour',
      6: 'degrees_celsius',
      7: 'degrees_farenheit',
      8: 'zone',
      9: 'gear',
      10: 'rpm',
      11: 'bpm',
      12: 'degrees',
      13: 'millimeters',
      14: 'meters',
      15: 'kilometers',
      16: 'feet',
      17: 'yards',
      18: 'kilofeet',
      19: 'miles',
      20: 'time',
      21: 'enum_turn_type',
      22: 'percent',
      23: 'watts',
      24: 'watts_per_kilogram',
      25: 'enum_battery_status',
      26: 'enum_bike_light_beam_angle_mode',
      27: 'enum_bike_light_battery_status',
      28: 'enum_bike_light_network_config_type',
      29: 'lights',
      30: 'seconds',
      31: 'minutes',
      32: 'hours',
      33: 'calories',
      34: 'kilojoules',
      35: 'milliseconds',
      36: 'second_per_mile',
      37: 'second_per_kilometer',
      38: 'centimeter',
      39: 'enum_course_point',
      40: 'bradians',
      41: 'enum_sport'
    },
    exd_qualifiers: {
      0: 'no_qualifier',
      1: 'instantaneous',
      2: 'average',
      3: 'lap',
      4: 'maximum',
      5: 'maximum_average',
      6: 'maximum_lap',
      7: 'last_lap',
      8: 'average_lap',
      9: 'to_destination',
      10: 'to_go',
      11: 'to_next',
      12: 'next_course_point',
      13: 'total',
      14: 'three_second_average',
      15: 'ten_second_average',
      16: 'thirty_second_average',
      17: 'percent_maximum',
      18: 'percent_maximum_average',
      19: 'lap_percent_maximum',
      20: 'elapsed',
      21: 'sunrise',
      22: 'sunset',
      23: 'compared_to_virtual_partner',
      24: 'maximum_24h',
      25: 'minimum_24h',
      26: 'minimum',
      27: 'first',
      28: 'second',
      29: 'third',
      30: 'shifter',
      242: 'zone_9',
      243: 'zone_8',
      244: 'zone_7',
      245: 'zone_6',
      246: 'zone_5',
      247: 'zone_4',
      248: 'zone_3',
      249: 'zone_2',
      250: 'zone_1'
    },
    exd_descriptors: {
      0: 'bike_light_battery_status',
      1: 'beam_angle_status',
      2: 'batery_level',
      3: 'light_network_mode',
      4: 'number_lights_connected',
      5: 'cadence',
      6: 'distance',
      7: 'estimated_time_of_arrival',
      8: 'heading',
      9: 'time',
      10: 'battery_level',
      11: 'trainer_resistance',
      12: 'trainer_target_power',
      13: 'time_seated',
      14: 'time_standing',
      15: 'elevation',
      16: 'grade',
      17: 'ascent',
      18: 'descent',
      19: 'vertical_speed',
      20: 'di2_battery_level',
      21: 'front_gear',
      22: 'rear_gear',
      23: 'gear_ratio',
      24: 'heart_rate',
      25: 'heart_rate_zone',
      26: 'time_in_heart_rate_zone',
      27: 'heart_rate_reserve',
      28: 'calories',
      29: 'gps_accuracy',
      30: 'gps_signal_strength',
      31: 'temperature',
      32: 'time_of_day',
      33: 'balance',
      34: 'pedal_smoothness',
      35: 'power',
      36: 'functional_threshold_power',
      37: 'intensity_factor',
      38: 'work',
      39: 'power_ratio',
      40: 'normalized_power',
      41: 'training_stress_Score',
      42: 'time_on_zone',
      43: 'speed',
      44: 'laps',
      45: 'reps',
      46: 'workout_step',
      47: 'course_distance',
      48: 'navigation_distance',
      49: 'course_estimated_time_of_arrival',
      50: 'navigation_estimated_time_of_arrival',
      51: 'course_time',
      52: 'navigation_time',
      53: 'course_heading',
      54: 'navigation_heading',
      55: 'power_zone',
      56: 'torque_effectiveness',
      57: 'timer_time',
      58: 'power_weight_ratio',
      59: 'left_platform_center_offset',
      60: 'right_platform_center_offset',
      61: 'left_power_phase_start_angle',
      62: 'right_power_phase_start_angle',
      63: 'left_power_phase_finish_angle',
      64: 'right_power_phase_finish_angle',
      65: 'gears',
      66: 'pace',
      67: 'training_effect',
      68: 'vertical_oscillation',
      69: 'vertical_ratio',
      70: 'ground_contact_time',
      71: 'left_ground_contact_time_balance',
      72: 'right_ground_contact_time_balance',
      73: 'stride_length',
      74: 'running_cadence',
      75: 'performance_condition',
      76: 'course_type',
      77: 'time_in_power_zone',
      78: 'navigation_turn',
      79: 'course_location',
      80: 'navigation_location',
      81: 'compass',
      82: 'gear_combo'
    },
    supported_exd_screen_layouts: {
      0: 0,
      1: 'full_screen',
      2: 'half_vertical',
      4: 'half_horizontal',
      8: 'half_vertical_right_split',
      16: 'half_horizontal_bottom_split',
      32: 'full_quarter_split',
      64: 'half_vertical_left_split',
      128: 'half_horizontal_top_split'
    },
    fit_base_type: {
      0: 'enum',
      1: 'sint8',
      2: 'uint8',
      7: 'string',
      10: 'uint8z',
      13: 'byte',
      131: 'sint16',
      132: 'uint16',
      133: 'sint32',
      134: 'uint32',
      136: 'float32',
      137: 'float64',
      139: 'uint16z',
      140: 'uint32z'
    },
    turn_type: {
      0: 'arriving_idx',
      1: 'arriving_left_idx',
      2: 'arriving_right_idx',
      3: 'arriving_via_idx',
      4: 'arriving_via_left_idx',
      5: 'arriving_via_right_idx',
      6: 'bear_keep_left_idx',
      7: 'bear_keep_right_idx',
      8: 'continue_idx',
      9: 'exit_left_idx',
      10: 'exit_right_idx',
      11: 'ferry_idx',
      12: 'roundabout_45_idx',
      13: 'roundabout_90_idx',
      14: 'roundabout_135_idx',
      15: 'roundabout_180_idx',
      16: 'roundabout_225_idx',
      17: 'roundabout_270_idx',
      18: 'roundabout_315_idx',
      19: 'roundabout_360_idx',
      20: 'roundabout_neg_45_idx',
      21: 'roundabout_neg_90_idx',
      22: 'roundabout_neg_135_idx',
      23: 'roundabout_neg_180_idx',
      24: 'roundabout_neg_225_idx',
      25: 'roundabout_neg_270_idx',
      26: 'roundabout_neg_315_idx',
      27: 'roundabout_neg_360_idx',
      28: 'roundabout_generic_idx',
      29: 'roundabout_neg_generic_idx',
      30: 'sharp_turn_left_idx',
      31: 'sharp_turn_right_idx',
      32: 'turn_left_idx',
      33: 'turn_right_idx',
      34: 'uturn_left_idx',
      35: 'uturn_right_idx',
      36: 'icon_inv_idx',
      37: 'icon_idx_cnt'
    },
    bike_light_beam_angle_mode: {
      0: 'manual',
      1: 'auto'
    },
    fit_base_unit: {
      0: 'other'
    }
  }
};

function getMessageName(messageNum) {
  var message = FIT.messages[messageNum];
  return message ? message.name : '';
}

function getFieldObject(fieldNum, messageNum) {
  var message = FIT.messages[messageNum];
  if (!message) {
    return '';
  }
  var fieldObj = message[fieldNum];
  return fieldObj ? fieldObj : {};
}
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.getFitMessage = getFitMessage;
exports.getFitMessageBaseType = getFitMessageBaseType;

var _fit = require('./fit');

function getFitMessage(messageNum) {
  return {
    name: (0, _fit.getMessageName)(messageNum),
    getAttributes: function getAttributes(fieldNum) {
      return (0, _fit.getFieldObject)(fieldNum, messageNum);
    }
  };
}

// TODO
function getFitMessageBaseType(foo) {
  return foo;
}
//# sourceMappingURL=easy-fit.js.map

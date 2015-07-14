///////////////////////////////////
//
//	 Server Configuration File
//
///////////////////////////////////

// Web-Server
var ws = {};
module.exports.ws = ws;
ws.port = 8080;
ws.securePort = 443;
ws.secured = false; //HTTPS support

//Database
var db = {};
module.exports.db = db;
db.present = false;  // DB presence
db.host = 'localhost';
db.user     = 'user' ;
db.password = 'password' ;
db.database = 'webrtcdb' ;
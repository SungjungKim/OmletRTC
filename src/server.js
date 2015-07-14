//Server Initiation
var express = require('express');
var fs = require('fs');
var app = express() ;


var config = require('./config');
var events = require('./js/events') ;
var bodyParser = require('body-parser');

app.use(bodyParser.json()); // for parsing application/json
app.use(bodyParser.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

// DB Integration
if( config.db.present )
{
	var mysql = require('mysql');
	var dbController = require('./db');
	var connection = mysql.createConnection({
	  host     : config.db.host,
	  user     : config.db.user,
	  password : config.db.password,
	  database : config.db.database
	});
	connection.connect(function(err) {
	  if( err)
		console.log(err);
	});
}

if ( config.ws.secured ) { // HTTPS Setup
    var https = require('https');
    var options = {
        key: fs.readFileSync('./server.key').toString(),
        cert: fs.readFileSync('./server.crt').toString()
    };
    var securePort = process.env.OPENSHIFT_NODEJS_PORT || config.ws.securePort;
    server = https.createServer(options,app).listen(securePort);
} else{ //HTTP Setup
    var http = require('http') ;
    var port = process.env.OPENSHIFT_NODEJS_PORT  || config.ws.port;
	var ip = process.env.OPENSHIFT_NODEJS_IP || "127.0.0.1"
    server = http.createServer(app).listen(port,ip);
}

var io = require('socket.io').listen(server);
//io.set('log level', 1); // reduce logging

var channelsInfo = {} ;

process.on('uncaughtException', function(err) {
  console.log('Caught exception: ' + err);
  console.log('Closing servers.');
  server.close();
});

process.on('exit', function(err) {
  console.log('Closing servers.');
    server.close();
});

// On new peer connected
io.sockets.on('connection',function(socket){
    console.log('on connection');
    if (!io.connected)
        io.connected = true;
    socket.on('channel', function(channel) { // On a peer joining a channel
        var t_ojm = Date.now() ;
        console.log('on joining channel: ' + channel + " at" + t_ojm.toString() ) ;
        socket.join(channel);
        socket.channel = channel ;
        if(channelsInfo[channel] === undefined ){
            channelsInfo[channel] = {};
            channelsInfo[channel].peers = {};
        }
        var t_jm = Date.now() ;
        console.log('Peer joined the room at ' + t_jm.toString() ) ;
    });
	
	socket.on('events',function(message){ // On receiving event logs from a peer
		console.log("Got Events Message");
		var output = "";
		var obj = JSON.parse(message);
		var values = [];
        var videoStats = [] ;
		// Extract Peer Info
        if( obj.videoStats ){
            videoStats = obj.videoStats ;
            console.log(JSON.stringify(videoStats));
        }
		var channel = obj['channel'] ;
		var isCaller = obj['isCaller'];
		var peer = {}
		peer.browser  = obj['browser'] ;
		peer.os  = obj['operating-system'] ;
		peer.network  = obj['network-type'] ;
		peer.device  = obj['device'];
		peer.events = obj['events'] ; //events is a dictionary. keys are values from events.js.
		peer.session = obj['session-type']; 
		peer.timestamp = obj['timestamp'] ;
		if (isCaller)
			channelsInfo[channel].peers['caller'] = peer ;
		else
			channelsInfo[channel].peers['callee'] = peer ;

        // If info from both peers are collected
		if (channelsInfo[channel].peers['caller'] != undefined && channelsInfo[channel].peers['callee'] != undefined)
		{
			var peer1 = channelsInfo[channel].peers['caller'];
			var peer2 = channelsInfo[channel].peers['callee'];
			if ( peer1.session != peer2.session) 
			{
				console.log( 'Session type mismatch for channel ' + channel , function (err) {});
			}
			else
			{
                var timings1 = {};
                timings1['init_peer_connection'] = peer1.events[events.Events.PC_CREATED] -  peer1.events[events.Events.CREATING_PC] |0;
                timings1['get_stream_from_device'] = peer1.events[events.Events.LOCAL_MEDIA_CAPTURED] -  peer1.events[events.Events.GETTING_MEDIA] |0 ;
                timings1['open_data_channel'] = peer1.events[events.Events.DATA_CHANNEL_OPENED] -  peer1.events[events.Events.CREATING_DATA_CHANNEL] | 0;
                var timings2 = {};
                timings2['init_peer_connection'] = peer2.events[events.Events.PC_CREATED] -  peer2.events[events.Events.CREATING_PC] |0 ;
                timings2['get_stream_from_device'] = peer2.events[events.Events.LOCAL_MEDIA_CAPTURED] -  peer2.events[events.Events.GETTING_MEDIA] |0 ;
                timings2['open_data_channel'] = peer2.events[events.Events.DATA_CHANNEL_OPENED] -  peer2.events[events.Events.CREATING_DATA_CHANNEL] |0;


                //Dumping experiment info into text file
				output += "[Peer1]" + peer1.device +","+ peer1.os +","+peer1.browser +","+ peer1.network + ", " +  peer1.timestamp + "[END] \n" ;
				output += "[Peer2]" +  peer2.device +","+ peer2.os +","+peer2.browser +","+ peer2.network+ ", " +  peer2.timestamp + "[END] \n" ;
				output += "[EXPERIMENT] " + peer1.session +" [END] \n" ;
				output += "[TIMINGS1]" + JSON.stringify(timings1) +"[END] \n";
				output += "[TIMINGS2]" + JSON.stringify(timings2) +"[END] \n";
				fs.appendFile( './reports/' + channel+ '.txt', output , function (err) {});
				// Storing experiment info into database
				if( config.db.present )
				{		
					var caller = {device: peer1.device, os: peer1.os, browser: peer1.browser,network:peer1.network,timestamp:peer1.timestamp,timings:timings1};
					var callee = {device: peer2.device, os: peer2.os, browser: peer2.browser,network:peer2.network,timestamp:peer2.timestamp,timings:timings2};
					dbController.addExperiment(connection,caller,callee,peer1.session,'PC');
				}
				
			}
		}
    });
    // On receiving message from a peer
	socket.on('message',function(data){
			var t_rm = Date.now() ;
			console.log('On receiving message' + t_rm.toString() ) ;
			var signal = JSON.parse(data);
			// Broadcast the message to everyone else subscribed to this channel
			socket.broadcast.to(signal.channel).emit('message', data);
			var t_bm = Date.now() ;
			console.log('Message broadcasted s' + t_bm.toString() ) ;
	});
	// On peer disconnected
    socket.on('disconnect', function(){
		socket.leave(socket.channel);
	});
});



app.set('view engine', 'jade');
// Handle resource request by server
app.get('/',function(req,res){
	res.render( 'index' , {cid:req.param("channel") , video:req.param("video") ,data:req.param("data") } );
	//res.sendFile(__dirname + '/webRTCBench.html');

	//console.log( req.param("name") );
	//console.log(JSON.stringify(req.body));
});


app.get('/js/main2.js', function(req,res){
    res.sendFile(__dirname + '/js/main2.js');
});

app.get('/webRTCBench.html',function(req,res){
    res.sendFile(__dirname + '/webRTCBench.html');
});

app.get('/chatmaker.html',function(req,res){
    res.sendFile(__dirname + '/chatmaker.html');
});

app.get('/chat.html',function(req,res){
    res.sendFile(__dirname + '/chat.html');
});

app.get('/poll.html',function(req,res){
    res.sendFile(__dirname + '/poll.html');
});

app.get('/WebRTCBenchGuide.html', function(req,res){
	res.sendFile(__dirname + '/WebRTCBenchGuide.html');
});

app.get('/Scheme.png', function(req,res){
	res.sendFile(__dirname + '/Scheme.png');
});

app.get('/flow.png', function(req,res){
	res.sendFile(__dirname + '/flow.png');
});

app.get('/js/omlet.js', function(req,res){
    res.sendFile(__dirname + '/js/omlet.js');
});

app.get('/js/main.js', function(req,res){
    res.sendFile(__dirname + '/js/main.js');
});

app.get('/js/adapter.js', function(req,res){
    res.sendFile(__dirname + '/js/adapter.js');
});

app.get('/js/events.js', function(req,res){
    res.sendFile(__dirname + '/js/events.js');
});

app.get('/css/style.css', function(req,res){
    res.sendFile(__dirname + '/css/style.css');
});

app.get('/js/Chart.js', function(req,res){
    res.sendFile(__dirname + '/js/Chart.js');
});

app.get('/test.webm', function(req,res){
    res.sendFile(__dirname + '/test.webm');
});

app.get('/test.mp4', function(req,res){
    res.sendFile(__dirname + '/test.mp4');
});



app.get('/js/app.js', function(req,res){
    res.sendFile(__dirname + '/js/app.js');
});


app.get('/js/jQuery.fastClick.js', function(req,res){
    res.sendFile(__dirname + '/js/jQuery.fastClick.js');
});

app.get('/css/iphone.css', function(req,res){
    res.sendFile(__dirname + '/css/iphone.css');
});

app.get('/css/android_phone.css', function(req,res){
    res.sendFile(__dirname + '/css/android_phone.css');
});

//app.get('/iamges/.*', function(req,res){
//    res.sendFile(__dirname + '/images/.*');
//});

app.get('/main.js', function(req,res){
    res.sendFile(__dirname + '/main.js');
});
app.get('/adapter.js', function(req,res){
    res.sendFile(__dirname + '/adapter.js');
});
app.get('/webrtc-data.html', function(req,res){
    res.sendFile(__dirname + '/webrtc-data.html');
});


app.use(express.static('.'));





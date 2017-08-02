var express = require('express');
var bodyParser = require('body-parser');
var mongo = require('mongojs');
var db = mongo('localhost:27017/rena',['messages','reply_messages']);
var path    = require("path");
var request = require('request');
var xml = require('xml');
var async = require('async')

var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);

var fs = require('fs');
var speech = require('@google-cloud/speech')({
  projectId: 'xxxx',
  keyFilename: 'api-cloud-speech.json'
});

var restcomm_key = "xxxx",
    restcomm_token = "xxxx",
    from = "601xxxxxx"

app.use(bodyParser.urlencoded({
  extended: true,
  limit: '50mb'
}));
app.use(function(req, res, next) {
    var contentType = req.headers['content-type'] || ''
      , mime = contentType.split(';')[0];

    if (mime == 'application/json' || mime == 'application/x-www-form-urlencoded') {
      
      return next();
    }

    req.rawBody = '';
    req.setEncoding(null);
    req.on('data', function(chunk) {
        req.rawBody += chunk;
    });
    req.on('end', function() {
        next();
    });
});
app.engine('.html', require('ejs').__express);
app.set('view engine', 'html');
app.use(bodyParser.json());

app.use('/views', express.static(__dirname + '/views'));
app.use('/css', express.static(__dirname + '/css'));
app.use('/js', express.static(__dirname + '/js'));
app.use('/images', express.static(__dirname + '/images'));
app.use('/resources', express.static(__dirname + '/resources'));

app.use(function(req, res, next){
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers','X-Requested-With,content-type');
  res.setHeader('Access-Control-Allow-Credentials', true);

  next();
});

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

var port = process.env.PORT || 8080;

var router  = express.Router();
var router2 = express.Router();

var auth = require('http-auth');
var basic = auth.basic({
        realm: "Authentication Area"
    }, function (username, password, callback) {
        callback(username === "xxxxx" && password === "xxxxx");
    }
);

router.route('/:channel/record')
  .get(function(req, res){
    console.log('file: '+req.query.file);

    var split = req.query.file.split("/");
    var filename = split[split.length-1];
    console.log('filename: '+filename);

    var file = request
      ({url: req.query.file, rejectUnauthorized : false})
      .on('error', function(err) {
        console.log(err);
      })
      .on('response', function(response) {
        var st = response.pipe(fs.createWriteStream("./resources/"+filename));
        st.on('finish', function() {

          speech.recognize('./resources/'+filename, {
            encoding: 'LINEAR16',
            sampleRate: 8000,
            languageCode: 'ms-MY'
          }, function(err, transcript) {
            // transcript = 'how old is the Brooklyn Bridge' 
            if(transcript){
              console.log('transcript: '+transcript)
              var img = "/images/dev_con_logo.jpg"

                var di = db.messages.insert({
                  caller: req.query.caller_id,
                  callSid: req.query.sid,
                  //transcript1: place,
                  image: img,
                  message: transcript,
                  recording_url: req.query.file,
                  audio: './resources/'+filename,
                  channel: req.params.channel,
                  created_at: new Date(),
                  updated_at: new Date()
                }, function(err, items){
                      if(err)
                        res.send(err);

                      var date = new Date();

                      new_date = ('0'+date.getDate()).slice(-2)+"/"+('0'+(date.getMonth()+1)).slice(-2)+"/"+date.getFullYear()+" "+('0'+date.getHours()).slice(-2)+":"+('0'+date.getMinutes()).slice(-2)+":"+('0'+date.getSeconds()).slice(-2);

                      var msgs = {
                        id: mongo.ObjectId(items._id),
                        message: transcript,
                        image: img,
                        caller: req.query.caller_id,
                        callSid: req.query.sid,
                        recording_url: req.query.file,
                        created_at: new_date,
                        updated_at: new Date()

                      };
                      io.of('/'+req.params.channel).emit('message', msgs);

                });
                fs.createReadStream('./resources/'+filename).pipe(fs.createWriteStream('./resources/last.wav'));
                res.json(transcript);
            }
          });
        })
      })
  });

router.route('/:channel/messages')
  .get(function(req, res){

    async.waterfall([
      function(callback){
        db.reply_messages.find({channel: req.params.channel}).sort({created_at:-1}, function(err, items){
          if(err)
            res.send(err)

          callback(null, items)
        })
      },
      function(replies, callback){
        db.messages.find({channel: req.params.channel}).sort({created_at: -1}, function(err, items){
          if(err)
            res.send(err)

          var a = []
          items.forEach(function(v, k){
            items[k].messages = []
            replies.forEach(function(j, m){
              if(j.user_id == v._id.toString()){
                
                items[k].messages.push({message: j.message})
              }
            })
            
          })
          callback(null, items)
        })        
      }
      ],function(err,doc){

        res.json(doc)
    })
  })
  .post(function(req, res){

    db.reply_messages.insert({
      user_id: req.body.user_id,
      channel: req.params.channel,
      caller: req.body.caller,
      message: req.body.message,
      created_at: new Date()
    },function(err, items){
      if(err)
        res.send(err)

      request.post('http://'+restcomm_key+':'+restcomm_token+'@xxx.xxx.xxx.xxx/restcomm/2012-04-24/Accounts/'+restcomm_key+'/Calls.json',{
        form: {
          From: from,
          To: req.body.caller,
          Url: req.protocol+'://'+req.headers.host+'/api/'+req.params.channel+'/messages/'+req.body.user_id
        }
      }, function(error, response, body){

        res.json(items)

      });

    })
  })

router.route('/:channel/audio')
  .get(function(req, res){
    db.messages.find({channel: req.params.channel}).sort({created_at: -1}).limit(1, function(err, item){
      var stat = fs.statSync(item[0].audio);
      res.writeHead(200, {
        'Content-Type': 'audio/wav',
        'Content-Length': stat.size
      })
      fs.createReadStream(item[0].audio).pipe(res);
      
    })
  })

router.route('/:channel/messages/:user_id')
  .post(function(req, res){
    db.reply_messages.find({channel: req.params.channel, user_id: req.params.user_id}).sort({created_at: -1})
    .limit(1, function(err, item){

      res.set('Content-Type','application/xml')
      var xmlRes = {
        Response: [
          {
            Say: item[0].message
          }
        ]
      }
      res.send(xml(xmlRes))
    })
  })

router2.route('/:channel')
  .get(function(req, res){
    io.of('/'+req.params.channel).on('connection', function(socket){
      console.log('a user connected to channel: '+req.params.channel);

      socket.on('disconnect', function(){
        console.log('user disconnected');
      });

      socket.on('message', function(msg){
        console.log('message: ' + msg);
      });
    });

    res.render('index',{
      channel: req.params.channel,
      root: __dirname
    })
  })

app.use('/api', router);
app.use(auth.connect(basic),router2);
http.listen(port, function(){
  console.log('listening on *:'+port);
});
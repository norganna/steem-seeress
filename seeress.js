var fs = require('fs');
var html_strip = require('htmlstrip-native');
var rpc = require('node-json-rpc');
var Discord = require('discord.io');

var callrpc = function(name, params, cb) {
	client.call(
			{'jsonrpc': '2.0',
				'method': name,
				'params': params,
				'id': 0},
				function(err, res) {
					if (err) { cb(err, null) }
					else { cb(null, res['result']) }
				}
			);
}

var channels = {};

var DEFAULT_TOKEN = 'edit-your-token-in-config.json';
var state = {
	discord_token: DEFAULT_TOKEN,
	steemd_options: {
		port: 8090,
		host: '127.0.0.1',
		path: '/rpc',
		strict: false
	},
    last_block: -1,
    listed: {},
    watching: {}
};

function load() {
    if (!fs.existsSync('config.json')) {
        return;
    }

    var c = fs.readFileSync('config.json', {encoding: 'utf8', flag: 'r'});
    if (c) {
        c = JSON.parse(c);
        if (c) {
            state = c;
        }
    }
}

function save() {
    fs.writeFileSync('config.json', JSON.stringify(state), {encoding: 'utf8', flag: 'w', mode: 0o666});
}

var process_block = function(block, blockid) {
    for (var i = 0; i < block.transactions.length; i++) {
        var t = block.transactions[i];
        if (t.operations) {
            for (var j = 0; j < t.operations.length; j++) {
                var o = t.operations[j];

                if (o[0] === 'comment' && o[1].parent_author === '') {
                    var c = o[1],
                        title = c.title,
                        author = c.author,
                        at_author = '@' + author,
                        parent_permlink = c.parent_permlink,
                        permlink = c.permlink,
                        body = c.body,
                        meta = JSON.parse(c.json_metadata ? c.json_metadata : '{}'),
                        tags = meta.tags,
                        interested = null;

                    body = html_strip.html_strip(body, {compact_whitespace: true, include_attributes: { alt: true, title: true }});

                    for (var cid in channels) {
                        var chan = channels[cid];

                        var negative_rex = chan.negative,
                            positive_rex = chan.positive;

                        // Check first to see if any of the negatives match, if so, abort.
                        if (!negative_rex) {
                            // No negatives to check, keep on rollin'
                        }

                        else if (negative_rex.test(title)) {
                            interested = false;
                        }

                        else if (negative_rex.test(at_author)) {
                            interested = false;
                        }

                        else if (negative_rex.test(body)) {
                            interested = false;
                        }

                        else if (tags) for (var k = 0; k < tags.length; k++) {
                            var tag = '#' + tags[k];
                            if (negative_rex.test(tag)) {
                                interested = false;
                                break;
                            }
                        }

                        // Now check the positives
                        if (interested === false) {
                            // No good, a negative matched, abort!
                        }

                        else if (positive_rex === true) {
                            // We're watching for all stories
                            interested = '';
                        }

                        else if (positive_rex.test(title)) {
                            var m = title.match(positive_rex),
                                word = m[1];

                            interested = ' with ‘' + word + '’ in the title';
                        }

                        else if (positive_rex.test(at_author)) {
                            var m = at_author.match(positive_rex),
                                word = m[1];

                            interested = ' with ‘' + word + '’ as the author';
                        }

                        else if (positive_rex.test(body)) {
                            var m = body.match(positive_rex),
                                word = m[1],
                                pos = m.index,
                                start = Math.max(0, pos-20),
                                end;

                            if (start < 5) {
                                start = 0;
                            }

                            end = pos + 30;
                            if (end > body.length - 5) {
                                end = body.length;
                            }

                            var found = body.substring(start, end);

                            if (start > 0) {
                                found = '…' + found.replace(/^\S+\s+[-,.;:]*/, '');
                            }
                            if (end < body.length) {
                                found = found.replace(/[-,.;:]*\s+\S+$/, '') + '…';
                            }

                            interested = ' with ‘' + m[0] + '’ keyword in body: “' + found + '”';
                        }

                        else if (tags) for (var k = 0; k < tags.length; k++) {
                            var tag = '#' + tags[k];
                            if (positive_rex.test(tag)) {
                                interested = 'with the ‘' + tag + '’ tag';
                                break;
                            }
                        }

                        // If we're still interested (no negatives and at least one positive match.
                        if (interested || interested === '') {
                            link = parent_permlink+'/@'+author+'/'+permlink;
                            if (!state.listed[cid+':'+link]) {
                                console.log('https://steemit.com/' + link, 'found', interested);
                                bot.sendMessage({
                                    to: cid,
                                    message: 'Found a story at https://steemit.com/' + link + interested + '.'
                                });

                                state.listed[cid+':'+link] = +(new Date);
                                save();
                            }
                        }
                    }
                }
            }
        }
    }
}

var fetch_block = function(block_id) {
    console.log('Getting block', block_id, '...');
    callrpc('get_block', [block_id], function(err, block) {
        process_block(block, block_id);
    });
}

var bot_ready = false,
    steem_ready = false;

var start_loop = function() {
    if (!bot_ready || !steem_ready) {
        return;
    }

    var delay = block_interval * 1000;

    callrpc('get_dynamic_global_properties', [], function(err, props) {
        if (err) {
            console.log('Error getting last block number:', err);
        } else {
            var block_number = props['last_irreversible_block_num'];
			if (state.last_block === -1) {
				state.last_block = block_number;
			}

            if ((block_number - state.last_block) > 0) {
                state.last_block += 1;
                fetch_block(state.last_block);
                save();
            }

            if ((block_number - state.last_block) > 0) {
                delay = 50;
            }
        }
        setTimeout(start_loop, delay);
    });
}

function make_rex(words) {
    if (!words || !words.length) {
        return null;
    }

    var rex_list = [];
    for (var i = 0; i < words.length; i++) {
        rex_list.push(
            words[i]
                .replace('\\', '\\\\')
                .replace('.', '\\.')
                .replace('+', '\\+')
                .replace('^', '\\^')
                .replace('|', '\\|')
                .replace('(', '\\(')
                .replace(')', '\\)')
                .replace('[', '\\[')
                .replace(']', '\\]')
                .replace('{', '\\{')
                .replace('}', '\\}')
                .replace('*', '.*')
                .replace('?', '.')
        );
    }

    var rex_text = '\\b(' + rex_list.join('|') + ')\\b';
    return new RegExp(rex_text, 'i');
}

function human_list(words) {
    if (words.length < 1) {
        return 'nothing';
    } else if (words.length === 1) {
        return '‘' + words[0] + '’';
    } else if (words.length === 2) {
        return '‘' + words[0] + '’ and ‘' + words[1] + '’';
    } else {
        return '‘' + words.slice(0, -1).join('’, ‘') + '’ and ‘' + words[words.length - 1] + '’';
    }
}

function load_channels() {
    var channel_watch = {};
    for (var id in bot.channels) {
        var chan = bot.channels[id];

        if (!chan.topic) continue;

        var m = chan.topic.match(/steem-seeress=([^;\n]+)/);
        if (m && m[1]) {
            var words = m[1]
                .split(/\s*,\s*/);

            var positive_words = [],
                negative_words = [],
                match_all = false,
                match_none = false;
            for (var i = 0; i < words.length; i++) {
                var word = words[i],
                    c = word.charAt(0);

                if (word === '*') {
                    match_all = true;
                } else if (word === '!*' || word === '-*') {
                    match_none = true;
                } else if (c === '-' || c === '!') {
                   negative_words.push(word.substr(1));
                } else {
                   positive_words.push(word);
                }
            }

            positive_words.sort();
            negative_words.sort();

            var positive_rex = make_rex(positive_words),
                negative_rex = make_rex(negative_words);

            if (match_all) {
                positive_rex = true;
            }

            if (!match_none && (match_all || positive_words.length)) {
                var words_text;

                if (match_all) {
                    words_text = 'all stories';
                } else {
                    words_text = 'the keywords ' + human_list(positive_words);
                }

                if (negative_words.length) {
                    words_text += ', excluding ' + human_list(negative_words);
                }

                if (state.watching[id] !== words_text) {
                    bot.sendMessage({
                        to: id,
                        message: 'I’m now watching for ' + words_text + '.'
                    });
                    state.watching[id] = words_text;
                    save();
                }

                channel_watch[id] = {
                    id: id,
                    name: chan.name,
                    positive: positive_rex,
                    negative: negative_rex,
                    words: words_text
                };
            }
        }

        if (!channel_watch[id] && state.watching[id]) {
            bot.sendMessage({
                to: id,
                message: 'I’m no longer watching for any keywords.'
            });
            delete state.watching[id];
            save();
        }
    }

    channels = channel_watch;
}

load();

if (state.discord_token === DEFAULT_TOKEN) {
	save();
	console.log("Edit config.json to set your discord token");
	process.exit(1);
}

console.log('Connecting...');

var bot = new Discord.Client({
        token: state.discord_token,
        autorun: true
});

bot.on('ready', function() {
    console.log('Bot', bot.username, '(' + bot.id + ') is ready');

    load_channels();

    bot_ready = true;
    start_loop();
});

bot.on('channelDelete', function() {
    load_channels();
});

bot.on('channelUpdate', function() {
    load_channels();
});

bot.on('guildCreate', function() {
    load_channels();
});

bot.on('guildUpdate', function() {
    load_channels();
});

bot.on('guildDelete', function() {
    load_channels();
});

/*
bot.on('any', function() {
    console.log('Bot got', arguments);
});
//*/

var client = new rpc.Client(state.steemd_options);

var block_interval;

console.log('Getting config...');
callrpc('get_config', [],
    function (err, config) {
        if (err) { console.log(err); }
        else {
            block_interval = config['STEEMIT_BLOCK_INTERVAL']
            steem_ready = true;
            start_loop();
        }
    }
)

/* vim: set ai ts=4 sts=4 sw=4 tw=0 et : */

const express = require("express");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const path = require("path");

const app = express();
app.use(express.json());

const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error ${e.message}`);
    process.exit(1);
  }
};

initializeDBAndServer();

//Authenticate User JWT Token
const authenticateToken = (request, response, next) => {
  let jwtToken;
  const { authorization } = request.headers;
  if (authorization !== undefined) {
    jwtToken = authorization.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "twitter", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.userId = payload.userId;
        next();
      }
    });
  }
};

//Register User API-1
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const checkUserQuery = `
  SELECT *
  FROM user
  WHERE username = '${username}';`;
  const existUser = await db.get(checkUserQuery);
  if (existUser !== undefined) {
    response.status(400);
    response.send("User already exists");
  } else {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const addUserQuery = `
      INSERT INTO user (name, username, password, gender)
      VALUES ('${name}','${username}','${hashedPassword}','${gender}');`;
      await db.run(addUserQuery);
      response.send("User created successfully");
    }
  }
});

//Login User API-2
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const checkUserQuery = `
  SELECT *
  FROM user
  WHERE username = '${username}';`;
  const existUser = await db.get(checkUserQuery);
  if (existUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(
      password,
      existUser.password
    );
    if (isPasswordMatched) {
      const payload = { userId: existUser.user_id };
      const jwtToken = jwt.sign(payload, "twitter");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//User Feed API-3
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const userFeedQuery = `SELECT username, tweet, date_time AS dateTime
  FROM user u JOIN follower f ON u.user_id = f.following_user_id
  JOIN tweet t ON f.following_user_id = t.user_id
  WHERE f.follower_user_id = ${userId}
  ORDER BY t.date_time DESC
  LIMIT 4;`;
  const userFeed = await db.all(userFeedQuery);
  response.send(userFeed);
});

//User Followings API-4
app.get("/user/following/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const userFollowingQuery = `SELECT name
    FROM user JOIN follower ON user_id = following_user_id
    WHERE follower_user_id = ${userId};`;
  const userFollowings = await db.all(userFollowingQuery);
  response.send(userFollowings);
});

//User Followers API-5
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const userFollowerQuery = `SELECT name
    FROM user JOIN follower ON user_id = follower_user_id
    WHERE following_user_id = ${userId};`;
  const userFollowers = await db.all(userFollowerQuery);
  response.send(userFollowers);
});

const isUserFollow = async (request, response, next) => {
  const { tweetId } = request.params;
  const { userId } = request;
  const isUserFollowQuery = `SELECT *
    FROM user NATURAL JOIN tweet
    WHERE user_id IN (
        SELECT user_id
        FROM user JOIN follower ON user_id = following_user_id
        WHERE follower_user_id = ${userId}
    ) AND tweet_id = ${tweetId};`;
  const userFollow = await db.all(isUserFollowQuery);
  if (userFollow.length === 0) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    request.userId = userId;
    request.tweetId = tweetId;
    console.log(userFollow);
    next();
  }
};

//GET Tweet API-6
app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  isUserFollow,
  async (request, response) => {
    const { tweetId } = request;
    const { userId } = request;
    const getTweetQuery = `SELECT tweet, COUNT(DISTINCT like_id) AS likes, COUNT(DISTINCT reply_id) AS replies, date_time AS dateTime
    FROM tweet t
    JOIN like l ON t.tweet_id = l.tweet_id
    JOIN reply r ON t.tweet_id = r.tweet_id
    WHERE t.tweet_id = ${tweetId};
    `;
    const tweet = await db.get(getTweetQuery);
    response.send(tweet);
  }
);

//GET Tweet Likes API-7
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  isUserFollow,
  async (request, response) => {
    const { tweetId } = request;
    const { userId } = request;
    const tweetLikeQuery = `SELECT username
    FROM tweet t JOIN like l ON t.tweet_id = l.tweet_id
    JOIN user u ON u.user_id = l.user_id
    WHERE t.tweet_id = ${tweetId};`;
    const tweetLikes = await db.all(tweetLikeQuery);
    const likes = tweetLikes.map((like) => like.username);
    response.send({ likes: likes });
  }
);

//GET Reply Tweet API-8
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  isUserFollow,
  async (request, response) => {
    const { tweetId } = request;
    const { userId } = request;
    const tweetReplyQuery = `SELECT name, reply
    FROM tweet t JOIN reply r ON t.tweet_id = r.tweet_id
    JOIN user u ON u.user_id = r.user_id
    WHERE t.tweet_id = ${tweetId};`;
    const tweetReplies = await db.all(tweetReplyQuery);
    response.send({ replies: tweetReplies });
  }
);

//GET User Tweet API-9
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { userId } = request;
  const getUserTweetQuery = `SELECT tweet, COUNT(DISTINCT like_id) AS likes, COUNT(DISTINCT reply_id) AS replies, date_time AS dateTime
    FROM tweet t JOIN like l ON t.tweet_id = l.tweet_id
    JOIN reply r ON r.tweet_id = t.tweet_id
    WHERE t.user_id = ${userId}
    GROUP BY t.tweet_id`;
  const userTweet = await db.all(getUserTweetQuery);
  response.send(userTweet);
});

//ADD New Tweet API-10
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const { tweet } = request.body;
  const { userId } = request;
  const date = new Date();
  const formattedDate = `${date.getFullYear()}-${(
    "0" +
    (date.getMonth() + 1)
  ).slice(
    -2
  )}-${date.getDate()} ${date.getHours()}:${date.getMinutes()}:${date.getSeconds()}`;
  const addNewTweetQuery = `INSERT INTO tweet (tweet, user_id, date_time)
    VALUES ('${tweet}',${userId},'${formattedDate}');`;
  await db.run(addNewTweetQuery);
  response.send("Created a Tweet");
});

//Check the Tweet Created by the User
const isUserTweet = async (request, response, next) => {
  const { tweetId } = request.params;
  const { userId } = request;
  const checkUserTweetQuery = `SELECT *
  FROM tweet
  WHERE tweet_id = ${tweetId} AND user_id = ${userId};`;
  const userTweet = await db.get(checkUserTweetQuery);
  if (userTweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    request.userId = userId;
    request.tweetId = tweetId;
    next();
  }
};

//DELETE tweet API-11
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  isUserTweet,
  async (request, response) => {
    const { userId, tweetId } = request;
    const deleteTweetQuery = `DELETE FROM tweet
    WHERE tweet_id = ${tweetId};`;
    await db.run(deleteTweetQuery);
    response.send("Tweet Removed");
  }
);

module.exports = app;
